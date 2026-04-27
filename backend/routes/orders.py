from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Order, OrderItem

orders_bp = Blueprint('orders', __name__)

def order_to_dict(o):
    return {
        'id': o.id, 'table_id': o.table_id, 'currency': o.currency,
        'total_amount': o.total_amount, 'status': o.status,
        'receipt_sent': o.receipt_sent,
        'created_at': o.created_at.isoformat() if o.created_at else None
    }

@orders_bp.get('/')
def get_orders():
    db = db_session()
    try:
        skip  = int(request.args.get('skip', 0))
        limit = int(request.args.get('limit', 50))
        orders = db.query(Order).order_by(Order.created_at.desc()).offset(skip).limit(limit).all()
        return jsonify([order_to_dict(o) for o in orders])
    finally:
        db.close()

@orders_bp.get('/<int:order_id>')
def get_order(order_id):
    db = db_session()
    try:
        o = db.query(Order).filter(Order.id == order_id).first()
        if not o: return jsonify({'error': 'Order not found'}), 404
        result = order_to_dict(o)
        result['items'] = [
            {'id': i.id, 'product_id': i.product_id, 'quantity': i.quantity,
             'unit_price': i.unit_price, 'subtotal': i.subtotal}
            for i in o.items
        ]
        return jsonify(result)
    finally:
        db.close()

@orders_bp.post('/')
def create_order():
    db = db_session()
    try:
        data = request.get_json()
        o = Order(
            table_id=data.get('table_id'), currency=data.get('currency', 'LKR'),
            total_amount=data.get('total_amount', 0), status=data.get('status', 'pending')
        )
        db.add(o); db.flush()
        for item in data.get('items', []):
            db.add(OrderItem(
                order_id=o.id, product_id=item['product_id'],
                quantity=item['quantity'], unit_price=item['unit_price'], subtotal=item['subtotal']
            ))
        db.commit(); db.refresh(o)
        return jsonify(order_to_dict(o)), 201
    finally:
        db.close()

@orders_bp.patch('/<int:order_id>/status')
def update_order_status(order_id):
    db = db_session()
    try:
        o = db.query(Order).filter(Order.id == order_id).first()
        if not o: return jsonify({'error': 'Order not found'}), 404
        o.status = request.args.get('status', o.status)
        db.commit()
        return jsonify({'message': 'Status updated'})
    finally:
        db.close()
