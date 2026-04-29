from datetime import datetime, timezone

from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Order, OrderItem, Payment

orders_bp = Blueprint('orders', __name__)


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


def _item_to_dict(item):
    return {
        'id': item.id,
        'uuid': str(item.uuid),
        'product_uuid': item.product_uuid,
        'product_id': item.product_id,
        'product_name': item.product_name,
        'product_sku': item.product_sku,
        'quantity': float(item.quantity) if item.quantity is not None else 0,
        'unit_price': float(item.unit_price) if item.unit_price is not None else 0.0,
        'discount_amount': float(item.discount_amount) if item.discount_amount is not None else 0.0,
        'vat_rate': float(item.vat_rate) if item.vat_rate is not None else 0.0,
        'vat_amount': float(item.vat_amount) if item.vat_amount is not None else 0.0,
        'line_total': float(item.line_total) if item.line_total is not None else 0.0,
        'notes': item.notes,
        'created_at': item.created_at.isoformat() if item.created_at else None,
    }


def _payment_to_dict(p):
    return {
        'id': p.id,
        'uuid': str(p.uuid),
        'payment_method': p.payment_method,
        'amount': float(p.amount) if p.amount is not None else 0.0,
        'currency': p.currency,
        'card_last4': p.card_last4,
        'card_brand': p.card_brand,
        'transaction_ref': p.transaction_ref,
        'status': p.status,
        'paid_at': p.paid_at.isoformat() if p.paid_at else None,
        'created_at': p.created_at.isoformat() if p.created_at else None,
    }


def _order_to_dict(o, include_items=True, include_payments=True):
    d = {
        'id': o.id,
        'uuid': str(o.uuid),
        'outlet_id': o.outlet_id,
        'terminal_id': o.terminal_id,
        'created_by_staff_id': o.created_by_staff_id,
        'customer_id': o.customer_id,
        'table_uuid': o.table_uuid,
        'table_name': o.table_name,
        'terminal_order_ref': o.terminal_order_ref,
        'tax_invoice_no': o.tax_invoice_no,
        'tax_invoice_issued_at': o.tax_invoice_issued_at.isoformat() if o.tax_invoice_issued_at else None,
        'currency': o.currency,
        'subtotal': float(o.subtotal) if o.subtotal is not None else 0.0,
        'discount_amount': float(o.discount_amount) if o.discount_amount is not None else 0.0,
        'discount_reason': o.discount_reason,
        'service_charge': float(o.service_charge) if o.service_charge is not None else 0.0,
        'tax_amount': float(o.tax_amount) if o.tax_amount is not None else 0.0,
        'total_amount': float(o.total_amount) if o.total_amount is not None else 0.0,
        'paid_amount': float(o.paid_amount) if o.paid_amount is not None else 0.0,
        'change_amount': float(o.change_amount) if o.change_amount is not None else 0.0,
        'status': o.status,
        'void_reason': o.void_reason,
        'voided_by_staff_id': o.voided_by_staff_id,
        'notes': o.notes,
        'order_created_at': o.order_created_at.isoformat() if o.order_created_at else None,
        'synced_at': o.synced_at.isoformat() if o.synced_at else None,
        'updated_at': o.updated_at.isoformat() if o.updated_at else None,
    }
    if include_items:
        d['items'] = [_item_to_dict(i) for i in o.items]
    if include_payments:
        d['payments'] = [_payment_to_dict(p) for p in o.payments]
    return d


@orders_bp.route('/', methods=['GET'])
def list_orders():
    db = get_db()
    try:
        outlet_id = request.args.get('outlet_id', type=int)
        terminal_id = request.args.get('terminal_id', type=int)
        status = request.args.get('status')
        date_from = _parse_dt(request.args.get('date_from'))
        date_to = _parse_dt(request.args.get('date_to'))
        skip = request.args.get('skip', 0, type=int)
        limit = min(request.args.get('limit', 50, type=int), 200)

        q = db.query(Order)
        if outlet_id:
            q = q.filter(Order.outlet_id == outlet_id)
        if terminal_id:
            q = q.filter(Order.terminal_id == terminal_id)
        if status:
            q = q.filter(Order.status == status)
        if date_from:
            q = q.filter(Order.order_created_at >= date_from)
        if date_to:
            q = q.filter(Order.order_created_at <= date_to)

        total = q.count()
        orders = q.order_by(Order.order_created_at.desc()).offset(skip).limit(limit).all()

        return jsonify({
            'total': total,
            'skip': skip,
            'limit': limit,
            'orders': [_order_to_dict(o) for o in orders],
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@orders_bp.route('/<int:id>', methods=['GET'])
def get_order(id):
    db = get_db()
    try:
        order = db.query(Order).filter(Order.id == id).first()
        if not order:
            return jsonify({'error': 'Order not found'}), 404
        return jsonify(_order_to_dict(order))
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@orders_bp.route('/<int:id>/void', methods=['PUT'])
def void_order(id):
    db = get_db()
    try:
        order = db.query(Order).filter(Order.id == id).first()
        if not order:
            return jsonify({'error': 'Order not found'}), 404

        if order.status == 'cancelled':
            return jsonify({'error': 'Order is already voided'}), 409

        data = request.get_json(silent=True) or {}
        void_reason = (data.get('void_reason') or '').strip()
        if not void_reason:
            return jsonify({'error': 'void_reason is required'}), 400

        order.status = 'cancelled'
        order.void_reason = void_reason
        if data.get('voided_by_staff_id'):
            order.voided_by_staff_id = data['voided_by_staff_id']
        order.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(order)
        return jsonify(_order_to_dict(order))
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
