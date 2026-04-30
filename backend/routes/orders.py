"""Order routes."""
import uuid
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from models.models import Order, OrderItem, Payment, TerminalInfo, RestaurantTable
from utils import db_session, as_iso
from auth_utils import require_auth

orders_bp = Blueprint('orders', __name__)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _payment_dict(p: Payment) -> dict:
    return {
        'id': p.id,
        'uuid': p.uuid,
        'order_id': p.order_id,
        'payment_method': p.payment_method,
        'amount': p.amount,
        'currency': p.currency,
        'card_last4': p.card_last4,
        'card_brand': p.card_brand,
        'transaction_ref': p.transaction_ref,
        'status': p.status,
        'paid_at': as_iso(p.paid_at),
    }


def _item_dict(i: OrderItem) -> dict:
    return {
        'id': i.id,
        'uuid': i.uuid,
        'order_id': i.order_id,
        'product_uuid': i.product_uuid,
        'product_id': i.product_id,
        'product_name': i.product_name,
        'product_sku': i.product_sku,
        'quantity': i.quantity,
        'unit_price': i.unit_price,
        'discount_amount': i.discount_amount,
        'vat_rate': i.vat_rate,
        'vat_amount': i.vat_amount,
        'line_total': i.line_total,
        'notes': i.notes,
        'created_at': as_iso(i.created_at),
    }


def _order_dict(o: Order, items=None, payments=None, table_name=None) -> dict:
    return {
        'id': o.id,
        'uuid': o.uuid,
        'staff_id': o.staff_id,
        'customer_id': o.customer_id,
        'table_id': o.table_id,
        'table_name': table_name,
        'terminal_order_ref': o.terminal_order_ref,
        'tax_invoice_no': o.tax_invoice_no,
        'currency': o.currency,
        'subtotal': o.subtotal,
        'discount_amount': o.discount_amount,
        'discount_reason': o.discount_reason,
        'service_charge': o.service_charge,
        'tax_amount': o.tax_amount,
        'total_amount': o.total_amount,
        'paid_amount': o.paid_amount,
        'change_amount': o.change_amount,
        'status': o.status,
        'void_reason': o.void_reason,
        'voided_by_staff_id': o.voided_by_staff_id,
        'notes': o.notes,
        'order_created_at': as_iso(o.order_created_at),
        'updated_at': as_iso(o.updated_at),
        'sync_status': o.sync_status,
        'receipt_printed': o.receipt_printed,
        'items': [_item_dict(i) for i in (items or [])],
        'payments': [_payment_dict(p) for p in (payments or [])],
    }


def _load_full_order(db, order: Order, table_name=None) -> dict:
    items = db.query(OrderItem).filter(OrderItem.order_id == order.id).all()
    payments = db.query(Payment).filter(Payment.order_id == order.id).all()
    return _order_dict(order, items, payments, table_name=table_name)


@orders_bp.route('/', methods=['GET'])
def list_orders():
    status = request.args.get('status')
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    skip = request.args.get('skip', 0, type=int)
    limit = min(request.args.get('limit', 50, type=int), 200)

    db = db_session()
    try:
        q = db.query(Order)

        if status:
            q = q.filter(Order.status == status)
        if date_from:
            q = q.filter(Order.order_created_at >= date_from)
        if date_to:
            q = q.filter(Order.order_created_at <= date_to)

        orders = q.order_by(Order.order_created_at.desc()).offset(skip).limit(limit).all()
        # Batch-load table names to avoid N+1
        table_ids = {o.table_id for o in orders if o.table_id}
        tables = {t.id: t.name for t in db.query(RestaurantTable).filter(RestaurantTable.id.in_(table_ids)).all()} if table_ids else {}
        return jsonify([_load_full_order(db, o, table_name=tables.get(o.table_id)) for o in orders]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@orders_bp.route('/<int:id>', methods=['GET'])
def get_order(id):
    db = db_session()
    try:
        o = db.query(Order).filter(Order.id == id).first()
        if not o:
            return jsonify({'error': 'Order not found'}), 404
        return jsonify(_load_full_order(db, o)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@orders_bp.route('/', methods=['POST'])
def create_order():
    data = request.get_json(silent=True) or {}
    items_data = data.get('items', [])

    if not items_data:
        return jsonify({'error': 'items are required'}), 400

    db = db_session()
    try:
        now = datetime.now(timezone.utc)

        # Get terminal code for order ref
        terminal_info = db.query(TerminalInfo).first()
        terminal_code = terminal_info.terminal_code if terminal_info else 'LOCAL'

        # Resolve staff from auth header (optional auth)
        staff_id = None
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            try:
                from auth_utils import decode_token
                payload = decode_token(auth_header[7:].strip())
                staff_id = payload.get('sub')
            except Exception:
                pass

        discount_amount = float(data.get('discount_amount', 0) or 0)
        service_charge = float(data.get('service_charge', 0) or 0)
        currency = data.get('currency', 'LKR')

        # Create order first to get id for terminal_order_ref
        o = Order(
            uuid=str(uuid.uuid4()),
            staff_id=staff_id,
            customer_id=data.get('customer_id'),
            table_id=data.get('table_id'),
            currency=currency,
            subtotal=0,
            discount_amount=discount_amount,
            discount_reason=data.get('discount_reason', ''),
            service_charge=service_charge,
            tax_amount=0,
            total_amount=0,
            paid_amount=0,
            change_amount=0,
            status='pending',
            notes=data.get('notes', ''),
            order_created_at=now,
            updated_at=now,
            sync_status='pending',
            sync_attempts=0,
            receipt_printed=False,
        )
        db.add(o)
        db.flush()  # Get o.id

        o.terminal_order_ref = f'{terminal_code}-{o.id:04d}'

        # Build order items and calculate totals
        subtotal = 0.0
        tax_amount = 0.0
        order_items = []

        for item_data in items_data:
            qty = float(item_data.get('quantity', 1))
            unit_price = float(item_data.get('unit_price', 0))
            item_discount = float(item_data.get('discount_amount', 0) or 0)
            vat_rate = float(item_data.get('vat_rate', 0) or 0)

            vat_amount = round(qty * unit_price * vat_rate / 100, 2)
            line_total = round(qty * unit_price - item_discount + vat_amount, 2)

            subtotal += qty * unit_price - item_discount
            tax_amount += vat_amount

            oi = OrderItem(
                uuid=str(uuid.uuid4()),
                order_id=o.id,
                product_uuid=item_data.get('product_uuid'),
                product_id=item_data.get('product_id'),
                product_name=item_data.get('product_name', ''),
                product_sku=item_data.get('product_sku'),
                quantity=qty,
                unit_price=unit_price,
                discount_amount=item_discount,
                vat_rate=vat_rate,
                vat_amount=vat_amount,
                line_total=line_total,
                notes=item_data.get('notes', ''),
                created_at=now,
            )
            db.add(oi)
            order_items.append(oi)

        subtotal = round(subtotal, 2)
        tax_amount = round(tax_amount, 2)
        total_amount = round(subtotal + service_charge + tax_amount - discount_amount, 2)

        o.subtotal = subtotal
        o.tax_amount = tax_amount
        o.total_amount = total_amount

        db.commit()
        db.refresh(o)

        payments = db.query(Payment).filter(Payment.order_id == o.id).all()
        return jsonify(_order_dict(o, order_items, payments)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@orders_bp.route('/<int:id>/status', methods=['PUT'])
@require_auth()
def update_order_status(id):
    data = request.get_json(silent=True) or {}
    new_status = data.get('status')
    if not new_status:
        return jsonify({'error': 'status is required'}), 400

    valid_statuses = ('pending', 'completed', 'cancelled')
    if new_status not in valid_statuses:
        return jsonify({'error': f'status must be one of {valid_statuses}'}), 400

    db = db_session()
    try:
        o = db.query(Order).filter(Order.id == id).first()
        if not o:
            return jsonify({'error': 'Order not found'}), 404

        if new_status == 'cancelled':
            void_reason = data.get('void_reason', '').strip()
            if not void_reason:
                return jsonify({'error': 'void_reason is required when cancelling an order'}), 400
            o.void_reason = void_reason
            o.voided_by_staff_id = request.staff['sub']

        o.status = new_status
        o.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify(_load_full_order(db, o)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@orders_bp.route('/<int:id>/payments', methods=['POST'])
def add_payment(id):
    data = request.get_json(silent=True) or {}
    payment_method = data.get('payment_method')
    amount = data.get('amount')

    if not payment_method:
        return jsonify({'error': 'payment_method is required'}), 400
    if amount is None:
        return jsonify({'error': 'amount is required'}), 400

    db = db_session()
    try:
        o = db.query(Order).filter(Order.id == id).first()
        if not o:
            return jsonify({'error': 'Order not found'}), 404

        now = datetime.now(timezone.utc)
        amount = float(amount)

        p = Payment(
            uuid=str(uuid.uuid4()),
            order_id=o.id,
            payment_method=payment_method,
            amount=amount,
            currency=data.get('currency', o.currency),
            card_last4=data.get('card_last4'),
            card_brand=data.get('card_brand'),
            transaction_ref=data.get('transaction_ref'),
            status='completed',
            paid_at=now,
        )
        db.add(p)

        # Update order paid_amount and change_amount
        o.paid_amount = (o.paid_amount or 0) + amount
        o.change_amount = max(0, round(o.paid_amount - o.total_amount, 2))
        o.updated_at = now

        db.commit()
        db.refresh(p)
        return jsonify(_payment_dict(p)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@orders_bp.route('/stats', methods=['GET'])
def order_stats():
    db = db_session()
    try:
        from datetime import date
        today = date.today().isoformat()
        completed = db.query(Order).filter(
            Order.status == 'completed',
            Order.order_created_at >= today
        ).all()
        sales_lkr = sum(o.total_amount for o in completed if o.currency == 'LKR')
        sales_usd = sum(o.total_amount for o in completed if o.currency == 'USD')
        order_count = len(completed)
        avg_order_lkr = (sales_lkr / order_count) if order_count > 0 else 0

        active_tables = db.query(RestaurantTable).join(
            RestaurantTable.table_status
        ).filter(
            RestaurantTable.is_active == True
        ).count()

        return jsonify({
            'sales_lkr': round(sales_lkr, 2),
            'sales_usd': round(sales_usd, 2),
            'order_count': order_count,
            'active_tables': active_tables,
            'avg_order_lkr': round(avg_order_lkr, 2),
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@orders_bp.route('/pending-sync', methods=['GET'])
def pending_sync():
    db = db_session()
    try:
        orders = (
            db.query(Order)
            .filter(Order.sync_status != 'synced')
            .order_by(Order.order_created_at)
            .all()
        )
        return jsonify([_load_full_order(db, o) for o in orders]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
