from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Order, OrderItem, Product, RestaurantTable

orders_bp = Blueprint('orders', __name__)

def order_to_dict(o, include_items=False):
    result = {
        'id':           o.id,
        'table_id':     o.table_id,
        'table_name':   o.table.name if o.table else 'Counter',
        'currency':     o.currency,
        'total_amount': o.total_amount,
        'status':       o.status,
        'receipt_sent': o.receipt_sent,
        'item_count':   len(o.items),
        'created_at':   o.created_at.isoformat() if o.created_at else None,
    }
    if include_items:
        result['items'] = [
            {
                'id':           i.id,
                'product_id':   i.product_id,
                'product_name': i.product.name if i.product else '',
                'quantity':     i.quantity,
                'unit_price':   i.unit_price,
                'subtotal':     i.subtotal,
            }
            for i in o.items
        ]
    return result

@orders_bp.get('/stats')
def get_stats():
    """Dashboard stats for today."""
    from datetime import datetime, date
    db = db_session()
    try:
        today_start = datetime.combine(date.today(), datetime.min.time())
        all_today = db.query(Order).filter(Order.created_at >= today_start).all()
        active = [o for o in all_today if o.status != 'cancelled']

        sales_lkr = sum(o.total_amount for o in active if o.currency == 'LKR')
        sales_usd = sum(o.total_amount for o in active if o.currency == 'USD')
        order_count = len(active)

        active_tables = db.query(RestaurantTable).filter(
            RestaurantTable.status.in_(['occupied', 'billed'])
        ).count()

        completed_lkr = [o for o in active if o.status == 'completed' and o.currency == 'LKR']
        avg_lkr = round(sum(o.total_amount for o in completed_lkr) / len(completed_lkr), 2) if completed_lkr else 0

        return jsonify({
            'sales_lkr':    sales_lkr,
            'sales_usd':    sales_usd,
            'order_count':  order_count,
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
        data = request.get_json()
        o = Order(
            table_id=data.get('table_id'),
            currency=data.get('currency', 'LKR'),
            total_amount=data.get('total_amount', 0),
            status=data.get('status', 'completed'),
        )
        db.add(o); db.flush()

        for item in data.get('items', []):
            db.add(OrderItem(
                order_id=o.id,
                product_id=item.get('product_id'),
                quantity=item['quantity'],
                unit_price=item['unit_price'],
                subtotal=item['subtotal'],
            ))

        # Mark table as billed after checkout
        if data.get('table_id'):
            t = db.query(RestaurantTable).filter(RestaurantTable.id == data['table_id']).first()
            if t:
                t.status = 'billed'

        db.commit(); db.refresh(o)
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
        o.status = request.args.get('status', o.status)
        db.commit()
        return jsonify({'message': 'Status updated'})
    finally:
        db.close()
