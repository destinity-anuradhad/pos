from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Outlet

outlets_bp = Blueprint('outlets', __name__)


def _outlet_to_dict(o):
    return {
        'id': o.id,
        'name': o.name,
        'code': o.code,
        'address': o.address,
        'is_active': o.is_active,
        'created_at': o.created_at.isoformat() if o.created_at else None,
    }


@outlets_bp.get('/')
def list_outlets():
    db = get_db()
    try:
        active_only = request.args.get('active_only', 'false').lower() == 'true'
        q = db.query(Outlet)
        if active_only:
            q = q.filter(Outlet.is_active == True)  # noqa: E712
        outlets = q.order_by(Outlet.name).all()
        return jsonify([_outlet_to_dict(o) for o in outlets]), 200
    finally:
        db.close()


@outlets_bp.post('/')
def create_outlet():
    """
    Payload:
    { "name": "Colombo Branch", "code": "COL-01", "address": "123 Main St" }
    """
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    code = data.get('code', '').strip()

    if not name:
        return jsonify({'error': 'name is required'}), 400
    if not code:
        return jsonify({'error': 'code is required'}), 400

    db = get_db()
    try:
        existing = db.query(Outlet).filter(Outlet.code == code).first()
        if existing:
            return jsonify({'error': f"Outlet with code '{code}' already exists"}), 409

        outlet = Outlet(
            name=name,
            code=code,
            address=data.get('address', ''),
            is_active=data.get('is_active', True),
        )
        db.add(outlet)
        db.commit()
        db.refresh(outlet)
        return jsonify(_outlet_to_dict(outlet)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@outlets_bp.get('/<int:outlet_id>')
def get_outlet(outlet_id):
    db = get_db()
    try:
        outlet = db.query(Outlet).filter(Outlet.id == outlet_id).first()
        if not outlet:
            return jsonify({'error': 'Outlet not found'}), 404
        return jsonify(_outlet_to_dict(outlet)), 200
    finally:
        db.close()


@outlets_bp.put('/<int:outlet_id>')
def update_outlet(outlet_id):
    db = get_db()
    try:
        outlet = db.query(Outlet).filter(Outlet.id == outlet_id).first()
        if not outlet:
            return jsonify({'error': 'Outlet not found'}), 404

        data = request.get_json(silent=True) or {}
        if 'name' in data:
            outlet.name = data['name']
        if 'address' in data:
            outlet.address = data['address']
        if 'is_active' in data:
            outlet.is_active = bool(data['is_active'])

        db.commit()
        db.refresh(outlet)
        return jsonify(_outlet_to_dict(outlet)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
