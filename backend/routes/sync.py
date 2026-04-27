from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Product, Category, Order, RestaurantTable
from datetime import datetime

sync_bp = Blueprint('sync', __name__)

@sync_bp.get('/pull')
def pull_data():
    db = db_session()
    try:
        return jsonify({
            'categories': [{'id': c.id, 'name': c.name, 'color': c.color} for c in db.query(Category).all()],
            'products':   [{'id': p.id, 'name': p.name, 'category_id': p.category_id,
                            'price_lkr': p.price_lkr, 'price_usd': p.price_usd, 'barcode': p.barcode}
                           for p in db.query(Product).filter(Product.is_active == True).all()],
            'tables':     [{'id': t.id, 'name': t.name, 'capacity': t.capacity, 'status': t.status}
                           for t in db.query(RestaurantTable).all()],
            'timestamp':  datetime.utcnow().isoformat()
        })
    finally:
        db.close()

@sync_bp.post('/push')
def push_data():
    db = db_session()
    try:
        payload = request.get_json()
        synced = 0
        for od in payload.get('orders', []):
            db.add(Order(
                table_id=od.get('table_id'), currency=od.get('currency', 'LKR'),
                total_amount=od.get('total_amount', 0), status=od.get('status', 'completed'),
                synced_at=datetime.utcnow()
            ))
            synced += 1
        db.commit()
        return jsonify({'synced': synced, 'timestamp': datetime.utcnow().isoformat()})
    finally:
        db.close()
