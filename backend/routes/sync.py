"""Sync and customer routes."""
import uuid
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from models.models import (
    Category, Product, RestaurantTable, TableStatus,
    Staff, Order, OrderItem, Payment,
    SyncLog, Customer,
)
from utils import db_session
from auth_utils import require_auth

sync_bp = Blueprint('sync', __name__)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# ── Serialisers ──────────────────────────────────────────────────────────────

def _cat_dict(c: Category) -> dict:
    return {
        'id': c.id,
        'uuid': c.uuid,
        'name': c.name,
        'color': c.color,
        'icon': c.icon,
        'sort_order': c.sort_order,
        'is_visible': c.is_visible,
        'updated_at': c.updated_at.isoformat() if c.updated_at else None,
        'synced_at': c.synced_at.isoformat() if c.synced_at else None,
    }


def _product_dict(p: Product) -> dict:
    return {
        'id': p.id,
        'uuid': p.uuid,
        'outlet_product_uuid': p.outlet_product_uuid,
        'category_id': p.category_id,
        'name': p.name,
        'sku': p.sku,
        'barcode': p.barcode,
        'image_url': p.image_url,
        'price_lkr': p.price_lkr,
        'price_usd': p.price_usd,
        'vat_rate': p.vat_rate,
        'unit': p.unit,
        'track_stock': p.track_stock,
        'stock_quantity': p.stock_quantity,
        'is_available': p.is_available,
        'updated_at': p.updated_at.isoformat() if p.updated_at else None,
        'synced_at': p.synced_at.isoformat() if p.synced_at else None,
    }


def _table_dict(t: RestaurantTable, status: TableStatus = None) -> dict:
    return {
        'id': t.id,
        'uuid': t.uuid,
        'name': t.name,
        'capacity': t.capacity,
        'section': t.section,
        'status_id': t.status_id,
        'status_code': status.code if status else None,
        'status_label': status.label if status else None,
        'is_active': t.is_active,
        'updated_at': t.updated_at.isoformat() if t.updated_at else None,
        'synced_at': t.synced_at.isoformat() if t.synced_at else None,
    }


def _staff_dict(s: Staff) -> dict:
    return {
        'id': s.id,
        'uuid': s.uuid,
        'username': s.username,
        'display_name': s.display_name,
        'role': s.role,
        'is_active': s.is_active,
        'updated_at': s.updated_at.isoformat() if s.updated_at else None,
    }


def _customer_dict(c: Customer) -> dict:
    return {
        'id': c.id,
        'uuid': c.uuid,
        'phone': c.phone,
        'name': c.name,
        'loyalty_card_no': c.loyalty_card_no,
        'loyalty_points': c.loyalty_points,
        'notes': c.notes,
        'updated_at': c.updated_at.isoformat() if c.updated_at else None,
        'synced_at': c.synced_at.isoformat() if c.synced_at else None,
        'sync_status': c.sync_status,
    }


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
        'paid_at': p.paid_at.isoformat() if p.paid_at else None,
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
        'created_at': i.created_at.isoformat() if i.created_at else None,
    }


def _order_dict_full(o: Order, db) -> dict:
    items = db.query(OrderItem).filter(OrderItem.order_id == o.id).all()
    payments = db.query(Payment).filter(Payment.order_id == o.id).all()
    return {
        'id': o.id,
        'uuid': o.uuid,
        'staff_id': o.staff_id,
        'customer_id': o.customer_id,
        'table_id': o.table_id,
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
        'notes': o.notes,
        'order_created_at': o.order_created_at.isoformat() if o.order_created_at else None,
        'updated_at': o.updated_at.isoformat() if o.updated_at else None,
        'sync_status': o.sync_status,
        'items': [_item_dict(i) for i in items],
        'payments': [_payment_dict(p) for p in payments],
    }


def _sync_log_dict(s: SyncLog) -> dict:
    return {
        'id': s.id,
        'sync_type': s.sync_type,
        'direction': s.direction,
        'status': s.status,
        'records_affected': s.records_affected,
        'duration_ms': s.duration_ms,
        'error_message': s.error_message,
        'started_at': s.started_at.isoformat() if s.started_at else None,
        'finished_at': s.finished_at.isoformat() if s.finished_at else None,
    }


# ── Pull ─────────────────────────────────────────────────────────────────────

@sync_bp.route('/pull', methods=['GET'])
def pull():
    db = db_session()
    try:
        categories = db.query(Category).all()
        products = db.query(Product).all()
        tables = db.query(RestaurantTable).filter(RestaurantTable.is_active == True).all()
        staff = db.query(Staff).filter(Staff.is_active == True).all()

        # Build status lookup for tables
        status_ids = {t.status_id for t in tables if t.status_id}
        statuses = {}
        if status_ids:
            for st in db.query(TableStatus).filter(TableStatus.id.in_(status_ids)).all():
                statuses[st.id] = st

        return jsonify({
            'categories': [_cat_dict(c) for c in categories],
            'products': [_product_dict(p) for p in products],
            'tables': [_table_dict(t, statuses.get(t.status_id)) for t in tables],
            'staff': [_staff_dict(s) for s in staff],
            'timestamp': _now_iso(),
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


# ── Push (transaction upsert) ────────────────────────────────────────────────

@sync_bp.route('/push', methods=['POST'])
def push():
    data = request.get_json(silent=True) or {}
    orders_data = data.get('orders', [])

    db = db_session()
    try:
        now = datetime.now(timezone.utc)
        upserted = 0

        for od in orders_data:
            order_uuid = od.get('uuid')
            if not order_uuid:
                continue

            o = db.query(Order).filter(Order.uuid == order_uuid).first()
            if o:
                # Update sync status only — don't overwrite local order data
                o.sync_status = 'synced'
                o.synced_at = now
                o.updated_at = now
            else:
                o = Order(
                    uuid=order_uuid,
                    staff_id=od.get('staff_id'),
                    customer_id=od.get('customer_id'),
                    table_id=od.get('table_id'),
                    terminal_order_ref=od.get('terminal_order_ref'),
                    tax_invoice_no=od.get('tax_invoice_no'),
                    currency=od.get('currency', 'LKR'),
                    subtotal=od.get('subtotal', 0),
                    discount_amount=od.get('discount_amount', 0),
                    discount_reason=od.get('discount_reason', ''),
                    service_charge=od.get('service_charge', 0),
                    tax_amount=od.get('tax_amount', 0),
                    total_amount=od.get('total_amount', 0),
                    paid_amount=od.get('paid_amount', 0),
                    change_amount=od.get('change_amount', 0),
                    status=od.get('status', 'completed'),
                    notes=od.get('notes', ''),
                    order_created_at=od.get('order_created_at') or now,
                    updated_at=now,
                    sync_status='synced',
                )
                db.add(o)
                db.flush()

                for item_data in (od.get('items') or []):
                    oi = OrderItem(
                        uuid=item_data.get('uuid') or str(uuid.uuid4()),
                        order_id=o.id,
                        product_uuid=item_data.get('product_uuid'),
                        product_id=item_data.get('product_id'),
                        product_name=item_data.get('product_name', ''),
                        product_sku=item_data.get('product_sku'),
                        quantity=float(item_data.get('quantity', 1)),
                        unit_price=float(item_data.get('unit_price', 0)),
                        discount_amount=float(item_data.get('discount_amount', 0)),
                        vat_rate=float(item_data.get('vat_rate', 0)),
                        vat_amount=float(item_data.get('vat_amount', 0)),
                        line_total=float(item_data.get('line_total', 0)),
                        notes=item_data.get('notes', ''),
                        created_at=now,
                    )
                    db.add(oi)

                for pay_data in (od.get('payments') or []):
                    p = Payment(
                        uuid=pay_data.get('uuid') or str(uuid.uuid4()),
                        order_id=o.id,
                        payment_method=pay_data.get('payment_method', 'cash'),
                        amount=float(pay_data.get('amount', 0)),
                        currency=pay_data.get('currency', 'LKR'),
                        card_last4=pay_data.get('card_last4'),
                        card_brand=pay_data.get('card_brand'),
                        transaction_ref=pay_data.get('transaction_ref'),
                        status=pay_data.get('status', 'completed'),
                        paid_at=pay_data.get('paid_at') or now,
                    )
                    db.add(p)

            upserted += 1

        db.commit()
        return jsonify({'upserted': upserted, 'timestamp': _now_iso()}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


# ── Sync log ─────────────────────────────────────────────────────────────────

@sync_bp.route('/log', methods=['GET'])
def sync_log():
    db = db_session()
    try:
        logs = (
            db.query(SyncLog)
            .order_by(SyncLog.started_at.desc())
            .limit(50)
            .all()
        )
        return jsonify([_sync_log_dict(s) for s in logs]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


# ── Customers ─────────────────────────────────────────────────────────────────

@sync_bp.route('/customers', methods=['GET'])
def search_customers():
    phone = request.args.get('phone', '').strip()
    q = request.args.get('q', '').strip()

    db = db_session()
    try:
        query = db.query(Customer)

        if phone:
            query = query.filter(Customer.phone == phone)
        elif q:
            query = query.filter(
                Customer.phone.ilike(f'%{q}%') | Customer.name.ilike(f'%{q}%')
            )

        customers = query.limit(50).all()
        return jsonify([_customer_dict(c) for c in customers]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@sync_bp.route('/customers', methods=['POST'])
def create_or_find_customer():
    data = request.get_json(silent=True) or {}
    phone = (data.get('phone') or '').strip()
    if not phone:
        return jsonify({'error': 'phone is required'}), 400

    db = db_session()
    try:
        now = datetime.now(timezone.utc)
        c = db.query(Customer).filter(Customer.phone == phone).first()
        if c:
            return jsonify(_customer_dict(c)), 200

        c = Customer(
            uuid=str(uuid.uuid4()),
            phone=phone,
            name=data.get('name'),
            loyalty_card_no=None,
            loyalty_points=0,
            notes=data.get('notes'),
            updated_at=now,
            sync_status='pending',
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        return jsonify(_customer_dict(c)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
