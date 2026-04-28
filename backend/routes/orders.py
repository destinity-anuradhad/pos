from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Order, OrderItem, Product, RestaurantTable, TableStatus, Terminal
from datetime import datetime, date

orders_bp = Blueprint('orders', __name__)


def order_to_dict(o, include_items=False):
    result = {
        'id':                  o.id,
        'terminal_id':         o.terminal_id,
        'terminal_order_ref':  o.terminal_order_ref,
        'hq_order_id':         o.hq_order_id,
        'table_id':            o.table_id,
        'table_name':          o.table.name if o.table else 'Counter',
        'currency':            o.currency,
        'total_amount':        o.total_amount,
        'status':              o.status,
        'payment_method':      o.payment_method,
        'sync_status':         o.sync_status,
        'receipt_sent':        o.receipt_sent,
        'item_count':          len(o.items),
        'created_at':          o.created_at.isoformat() if o.created_at else None,
        'synced_at':           o.synced_at.isoformat()  if o.synced_at  else None,
    }
    if include_items:
        result['items'] = [
            {
                'id':           i.id,
                'product_id':   i.product_id,
                'product_name': i.product_name or (i.product.name if i.product else ''),
                'quantity':     i.quantity,
                'unit_price':   i.unit_price,
                'subtotal':     i.subtotal,
            }
            for i in o.items
        ]
    return result


def _next_order_seq(db, terminal_id):
    """Return the next sequence number for this terminal."""
    count = db.query(Order).filter(Order.terminal_id == terminal_id).count()
    return count + 1


@orders_bp.get('/stats')
def get_stats():
    db = db_session()
    try:
        today_start = datetime.combine(date.today(), datetime.min.time())
        all_today   = db.query(Order).filter(Order.created_at >= today_start).all()
        active      = [o for o in all_today if o.status != 'cancelled']

        sales_lkr   = sum(o.total_amount for o in active if o.currency == 'LKR')
        sales_usd   = sum(o.total_amount for o in active if o.currency == 'USD')
        order_count = len(active)

        active_tables = db.query(RestaurantTable).join(TableStatus).filter(
            TableStatus.code.in_(['seated', 'ordered', 'billed'])
        ).count()

        completed_lkr = [o for o in active if o.status == 'completed' and o.currency == 'LKR']
        avg_lkr = round(
            sum(o.total_amount for o in completed_lkr) / len(completed_lkr), 2
        ) if completed_lkr else 0

        return jsonify({
            'sales_lkr':     sales_lkr,
            'sales_usd':     sales_usd,
            'order_count':   order_count,
            'active_tables': active_tables,
            'avg_order_lkr': avg_lkr,
        })
    finally:
        db.close()


@orders_bp.get('/')
def get_orders():
    db = db_session()
    try:
        skip  = int(request.args.get('skip', 0))
        limit = int(request.args.get('limit', 50))
        orders = (db.query(Order)
                  .order_by(Order.created_at.desc())
                  .offset(skip).limit(limit).all())
        return jsonify([order_to_dict(o) for o in orders])
    finally:
        db.close()


@orders_bp.get('/<int:order_id>')
def get_order(order_id):
    db = db_session()
    try:
        o = db.query(Order).filter(Order.id == order_id).first()
        if not o:
            return jsonify({'error': 'Order not found'}), 404
        return jsonify(order_to_dict(o, include_items=True))
    finally:
        db.close()


@orders_bp.post('/')
def create_order():
    db = db_session()
    try:
        data        = request.get_json()
        terminal_id = data.get('terminal_id')
        terminal    = db.query(Terminal).filter(Terminal.id == terminal_id).first() if terminal_id else None

        # Build terminal_order_ref: COL-M-01-0045
        if terminal:
            seq = _next_order_seq(db, terminal_id)
            ref = f"{terminal.terminal_code}-{seq:04d}"
            terminal.last_seen_at = datetime.utcnow()
        else:
            ref = None

        o = Order(
            terminal_id        = terminal_id,
            terminal_order_ref = data.get('terminal_order_ref', ref),
            table_id           = data.get('table_id'),
            currency           = data.get('currency', 'LKR'),
            total_amount       = data.get('total_amount', 0),
            status             = data.get('status', 'completed'),
            payment_method     = data.get('payment_method'),
            sync_status        = data.get('sync_status', 'pending'),
        )
        db.add(o)
        db.flush()

        for item in data.get('items', []):
            # Snapshot product name at order time
            product = db.query(Product).filter(Product.id == item.get('product_id')).first()
            db.add(OrderItem(
                order_id     = o.id,
                product_id   = item.get('product_id'),
                product_name = item.get('product_name') or (product.name if product else ''),
                quantity     = item['quantity'],
                unit_price   = item['unit_price'],
                subtotal     = item['subtotal'],
            ))
            # Decrement stock
            if product and product.stock_quantity >= 0:
                product.stock_quantity = max(0, product.stock_quantity - item['quantity'])

        # Auto-transition table: Ordered → Billed on checkout
        if data.get('table_id'):
            t = db.query(RestaurantTable).filter(RestaurantTable.id == data['table_id']).first()
            if t:
                billed = db.query(TableStatus).filter(TableStatus.code == 'billed').first()
                if billed:
                    t.status_id = billed.id

        db.commit()
        db.refresh(o)
        return jsonify(order_to_dict(o, include_items=True)), 201
    finally:
        db.close()


@orders_bp.patch('/<int:order_id>/status')
def update_order_status(order_id):
    db = db_session()
    try:
        o = db.query(Order).filter(Order.id == order_id).first()
        if not o:
            return jsonify({'error': 'Order not found'}), 404

        new_status = request.args.get('status', o.status)
        o.status   = new_status

        # When payment confirmed (order completed) → table moves Billed → Cleaning
        if new_status == 'completed' and o.table_id:
            t = db.query(RestaurantTable).filter(RestaurantTable.id == o.table_id).first()
            if t:
                cleaning = db.query(TableStatus).filter(TableStatus.code == 'cleaning').first()
                if cleaning:
                    t.status_id = cleaning.id

        db.commit()
        return jsonify({'message': 'Status updated', 'status': o.status})
    finally:
        db.close()


@orders_bp.patch('/<int:order_id>/hq-id')
def assign_hq_order_id(order_id):
    """Called during sync to assign a head-office order ID."""
    db = db_session()
    try:
        o = db.query(Order).filter(Order.id == order_id).first()
        if not o:
            return jsonify({'error': 'Order not found'}), 404
        data = request.get_json()
        o.hq_order_id  = data.get('hq_order_id')
        o.sync_status  = 'synced'
        o.synced_at    = datetime.utcnow()
        db.commit()
        return jsonify({'message': 'HQ order ID assigned', 'hq_order_id': o.hq_order_id})
    finally:
        db.close()
