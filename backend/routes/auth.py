from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Staff
from auth_utils import verify_pin, create_token, require_auth

auth_bp = Blueprint('auth', __name__)


@auth_bp.get('/staff')
def list_staff():
    """Return active staff names + IDs for the login screen. No sensitive data."""
    db = db_session()
    try:
        staff = db.query(Staff).filter(Staff.is_active == True).order_by(Staff.name).all()
        return jsonify([{'id': s.id, 'name': s.name, 'role': s.role} for s in staff])
    finally:
        db.close()


@auth_bp.post('/login')
def login():
    """Verify PIN and return JWT token."""
    data = request.get_json(silent=True) or {}
    staff_id = data.get('staff_id')
    pin = str(data.get('pin', ''))

    if not staff_id or not pin:
        return jsonify({'error': 'staff_id and pin are required'}), 400
    if len(pin) < 4 or len(pin) > 8:
        return jsonify({'error': 'Invalid PIN'}), 400

    db = db_session()
    try:
        s = db.query(Staff).filter(Staff.id == staff_id, Staff.is_active == True).first()
        if not s or not verify_pin(pin, s.pin_hash):
            return jsonify({'error': 'Incorrect PIN'}), 401
        token = create_token(s.id, s.name, s.role)
        return jsonify({'token': token, 'name': s.name, 'role': s.role})
    finally:
        db.close()


@auth_bp.get('/me')
@require_auth()
def me():
    """Verify token is still valid and return staff info."""
    return jsonify(request.staff)
