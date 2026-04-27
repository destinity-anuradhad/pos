from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import RestaurantTable

tables_bp = Blueprint('tables', __name__)

def table_to_dict(t):
    return {'id': t.id, 'name': t.name, 'capacity': t.capacity, 'status': t.status}

@tables_bp.get('/')
def get_tables():
    db = db_session()
    try:
        return jsonify([table_to_dict(t) for t in db.query(RestaurantTable).all()])
    finally:
        db.close()

@tables_bp.post('/')
def create_table():
    db = db_session()
    try:
        data = request.get_json()
        t = RestaurantTable(name=data['name'], capacity=data.get('capacity', 4), status=data.get('status', 'available'))
        db.add(t); db.commit(); db.refresh(t)
        return jsonify(table_to_dict(t)), 201
    finally:
        db.close()

@tables_bp.put('/<int:table_id>')
def update_table(table_id):
    db = db_session()
    try:
        t = db.query(RestaurantTable).filter(RestaurantTable.id == table_id).first()
        if not t: return jsonify({'error': 'Table not found'}), 404
        data = request.get_json()
        for key in ['name', 'capacity', 'status']:
            if key in data: setattr(t, key, data[key])
        db.commit(); db.refresh(t)
        return jsonify(table_to_dict(t))
    finally:
        db.close()

@tables_bp.patch('/<int:table_id>/status')
def update_table_status(table_id):
    db = db_session()
    try:
        t = db.query(RestaurantTable).filter(RestaurantTable.id == table_id).first()
        if not t: return jsonify({'error': 'Table not found'}), 404
        t.status = request.args.get('status', t.status)
        db.commit()
        return jsonify({'message': 'Status updated'})
    finally:
        db.close()
