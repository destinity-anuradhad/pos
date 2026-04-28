from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Staff
from auth_utils import hash_pin, require_auth
from validation import _err

staff_bp = Blueprint('staff', __name__)

VALID_ROLES = {'cashier', 'manager', 'admin'}


def staff_to_dict(s):
    return {
        'id':         s.id,
        'name':       s.name,
        'role':       s.role,
        'is_active':  s.is_active,
        'created_at': s.created_at.isoformat() if s.created_at else None,
    }


@staff_bp.get('/')
@require_auth(roles=['admin'])
def list_staff():
    db = db_session()
    try:
        return jsonify([staff_to_dict(s) for s in db.query(Staff).order_by(Staff.name).all()])
    finally:
        db.close()


@staff_bp.post('/')
@require_auth(roles=['admin'])
def create_staff():
    db = db_session()
    try:
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()
        if not name:
            return _err('Name is required')
        if len(name) > 100:
            return _err('Name too long')
        role = data.get('role', 'cashier')
        if role not in VALID_ROLES:
            return _err(f'Invalid role. Allowed: {sorted(VALID_ROLES)}')
        pin = str(data.get('pin', ''))
        if len(pin) < 4 or len(pin) > 8 or not pin.isdigit():
            return _err('PIN must be 4-8 digits')
        existing = db.query(Staff).filter(Staff.name == name).first()
        if existing:
            return _err('A staff member with this name already exists')
        s = Staff(name=name, role=role, pin_hash=hash_pin(pin))
        db.add(s)
        db.commit()
        db.refresh(s)
        return jsonify(staff_to_dict(s)), 201
    finally:
        db.close()


@staff_bp.put('/<int:staff_id>')
@require_auth(roles=['admin'])
def update_staff(staff_id):
    db = db_session()
    try:
        s = db.query(Staff).filter(Staff.id == staff_id).first()
        if not s:
            return jsonify({'error': 'Not found'}), 404
        data = request.get_json(silent=True) or {}
        if 'name' in data:
            name = (data['name'] or '').strip()
            if not name or len(name) > 100:
                return _err('Invalid name')
            s.name = name
        if 'role' in data:
            if data['role'] not in VALID_ROLES:
                return _err(f'Invalid role')
            s.role = data['role']
        if 'pin' in data:
            pin = str(data['pin'])
            if len(pin) < 4 or len(pin) > 8 or not pin.isdigit():
                return _err('PIN must be 4-8 digits')
            s.pin_hash = hash_pin(pin)
        if 'is_active' in data:
            s.is_active = bool(data['is_active'])
        db.commit()
        db.refresh(s)
        return jsonify(staff_to_dict(s))
    finally:
        db.close()


@staff_bp.delete('/<int:staff_id>')
@require_auth(roles=['admin'])
def deactivate_staff(staff_id):
    db = db_session()
    try:
        s = db.query(Staff).filter(Staff.id == staff_id).first()
        if not s:
            return jsonify({'error': 'Not found'}), 404
        # Prevent deleting the last admin
        if s.role == 'admin':
            admin_count = db.query(Staff).filter(Staff.role == 'admin', Staff.is_active == True).count()
            if admin_count <= 1:
                return jsonify({'error': 'Cannot deactivate the last admin account'}), 400
        s.is_active = False
        db.commit()
        return jsonify({'message': 'Staff deactivated'})
    finally:
        db.close()
