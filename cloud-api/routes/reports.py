from datetime import datetime, timezone

from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Order, OrderItem, Payment, OutletProduct, Product, Outlet

reports_bp = Blueprint('reports', __name__)


def _parse_dt(value):
    if not value:
        return None
    try:
        if isinstance(value, str):
            value = value.replace('Z', '+00:00')
            return datetime.fromisoformat(value)
        return value
    except (ValueError, AttributeError):
        return None


def _apply_date_filters(q, model, date_from, date_to):
    if date_from:
        q = q.filter(model.order_created_at >= date_from)
    if date_to:
        q = q.filter(model.order_created_at <= date_to)
    return q


# ---------------------------------------------------------------------------
# GET /reports/sales
# ---------------------------------------------------------------------------

@reports_bp.route('/sales', methods=['GET'])
def sales_summary():
    db = get_db()
    try:
        outlet_id = request.args.get('outlet_id', type=int)
        date_from = _parse_dt(request.args.get('date_from'))
        date_to = _parse_dt(request.args.get('date_to'))

        # Orders query
        q = db.query(Order)
        if outlet_id:
            q = q.filter(Order.outlet_id == outlet_id)
        q = _apply_date_filters(q, Order, date_from, date_to)
        orders = q.all()

        total_orders = len(orders)
        total_revenue = 0.0
        total_tax = 0.0
        total_discount = 0.0
        by_status: dict = {}

        for o in orders:
            status_key = o.status or 'unknown'
            by_status[status_key] = by_status.get(status_key, 0) + 1
            if o.status != 'cancelled':
                total_revenue += float(o.total_amount or 0)
                total_tax += float(o.tax_amount or 0)
                total_discount += float(o.discount_amount or 0)

        # Payment method breakdown (from payments table, non-cancelled orders only)
        order_ids = [o.id for o in orders if o.status != 'cancelled']
        by_payment_method: dict = {}
        if order_ids:
            payments = db.query(Payment).filter(Payment.order_id.in_(order_ids)).all()
            for pay in payments:
                method = pay.payment_method or 'other'
                by_payment_method[method] = round(
                    by_payment_method.get(method, 0) + float(pay.amount or 0), 2
                )

        return jsonify({
            'total_orders': total_orders,
            'total_revenue': round(total_revenue, 2),
            'total_tax': round(total_tax, 2),
            'total_discount': round(total_discount, 2),
            'by_payment_method': by_payment_method,
            'by_status': by_status,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


# ---------------------------------------------------------------------------
# GET /reports/orders
# ---------------------------------------------------------------------------

@reports_bp.route('/orders', methods=['GET'])
def list_orders():
    db = get_db()
    try:
        outlet_id = request.args.get('outlet_id', type=int)
        date_from = _parse_dt(request.args.get('date_from'))
        date_to = _parse_dt(request.args.get('date_to'))
        skip = request.args.get('skip', 0, type=int)
        limit = min(request.args.get('limit', 50, type=int), 200)

        q = db.query(Order)
        if outlet_id:
            q = q.filter(Order.outlet_id == outlet_id)
        q = _apply_date_filters(q, Order, date_from, date_to)

        total = q.count()
        orders = q.order_by(Order.order_created_at.desc()).offset(skip).limit(limit).all()

        result = []
        for o in orders:
            result.append({
                'id': o.id,
                'uuid': str(o.uuid),
                'outlet_id': o.outlet_id,
                'terminal_id': o.terminal_id,
                'table_name': o.table_name,
                'terminal_order_ref': o.terminal_order_ref,
                'tax_invoice_no': o.tax_invoice_no,
                'currency': o.currency,
                'subtotal': float(o.subtotal or 0),
                'discount_amount': float(o.discount_amount or 0),
                'service_charge': float(o.service_charge or 0),
                'tax_amount': float(o.tax_amount or 0),
                'total_amount': float(o.total_amount or 0),
                'paid_amount': float(o.paid_amount or 0),
                'status': o.status,
                'order_created_at': o.order_created_at.isoformat() if o.order_created_at else None,
                'synced_at': o.synced_at.isoformat() if o.synced_at else None,
                'item_count': len(o.items),
            })

        return jsonify({
            'total': total,
            'skip': skip,
            'limit': limit,
            'orders': result,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


# ---------------------------------------------------------------------------
# GET /reports/stock
# ---------------------------------------------------------------------------

@reports_bp.route('/stock', methods=['GET'])
def stock_levels():
    db = get_db()
    try:
        outlet_id = request.args.get('outlet_id', type=int)
        if not outlet_id:
            return jsonify({'error': 'outlet_id is required'}), 400

        rows = (
            db.query(OutletProduct, Product)
            .join(Product, OutletProduct.product_id == Product.id)
            .filter(
                OutletProduct.outlet_id == outlet_id,
                Product.is_active == True,  # noqa: E712
            )
            .order_by(Product.name)
            .all()
        )

        result = []
        for op, prod in rows:
            result.append({
                'outlet_product_id': op.id,
                'outlet_product_uuid': str(op.uuid),
                'product_id': prod.id,
                'product_uuid': str(prod.uuid),
                'sku': prod.sku,
                'name': prod.name,
                'barcode': prod.barcode,
                'unit': prod.unit,
                'track_stock': prod.track_stock,
                'stock_quantity': float(op.stock_quantity or 0),
                'reorder_threshold': float(op.reorder_threshold) if op.reorder_threshold is not None else None,
                'is_available': op.is_available,
                'last_stock_update_at': op.last_stock_update_at.isoformat() if op.last_stock_update_at else None,
                'price_lkr': (
                    float(op.price_lkr_override)
                    if op.price_lkr_override is not None
                    else float(prod.default_price_lkr or 0)
                ),
            })

        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


# ---------------------------------------------------------------------------
# GET /reports/outlets
# ---------------------------------------------------------------------------

@reports_bp.route('/outlets', methods=['GET'])
def outlets_summary():
    db = get_db()
    try:
        date_from = _parse_dt(request.args.get('date_from'))
        date_to = _parse_dt(request.args.get('date_to'))

        outlets = db.query(Outlet).filter(Outlet.is_active == True).all()  # noqa: E712

        result = []
        for outlet in outlets:
            q = db.query(Order).filter(
                Order.outlet_id == outlet.id,
                Order.status != 'cancelled',
            )
            if date_from:
                q = q.filter(Order.order_created_at >= date_from)
            if date_to:
                q = q.filter(Order.order_created_at <= date_to)

            orders = q.all()
            order_count = len(orders)
            revenue = sum(float(o.total_amount or 0) for o in orders)

            result.append({
                'outlet_id': outlet.id,
                'outlet_uuid': str(outlet.uuid),
                'outlet_code': outlet.code,
                'outlet_name': outlet.name,
                'currency': outlet.currency,
                'order_count': order_count,
                'total_revenue': round(revenue, 2),
            })

        result.sort(key=lambda x: x['total_revenue'], reverse=True)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
