"""Staff management routes."""
import uuid
import bcrypt
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from models.models import Staff
from utils import db_session
from auth_utils import require_auth, hash_pin

staff_bp = Blueprint('staff', __name__)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _staff_dict(s: Staff) -> dict:
    return {
        'id': s.id,
        'uuid': s.uuid,
        'username': s.username,
        'display_name': s.display_name,
        'role': s.role,
        'is_active': s.is_active,
        'failed_login_count': s.failed_login_count,
        'locked_until': s.locked_until.isoformat() if s.locked_until else None,
        'updated_at': s.updated_at.isoformat() if s.updated_at else None,
    }


@staff_bp.route('/', methods=['GET'])
@require_auth(roles=['manager', 'admin'])
def list_staff():
    db = db_session()
    try:
        staff_list = db.query(Staff).filter(Staff.is_active == True).all()
        return jsonify([_staff_dict(s) for s in staff_list]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@staff_bp.route('/', methods=['POST'])
@require_auth(roles=['manager', 'admin'])
def create_staff():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    display_name = (data.get('display_name') or '').strip()
    role = (data.get('role') or '').strip()
    pin = data.get('pin')
    password = data.get('password')

    if not username:
        return jsonify({'error': 'username is required'}), 400
    if not display_name:
        return jsonify({'error': 'display_name is required'}), 400
    if role not in ('cashier', 'manager', 'admin'):
        return jsonify({'error': 'role must be cashier, manager, or admin'}), 400

    db = db_session()
    try:
        existing = db.query(Staff).filter(Staff.username == username).first()
        if existing:
            return jsonify({'error': 'Username already exists'}), 409

        pin_hash = hash_pin(str(pin)) if pin else None
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode() if password else None

        s = Staff(
            uuid=str(uuid.uuid4()),
            username=username,
            display_name=display_name,
            role=role,
            pin_hash=pin_hash,
            password_hash=password_hash,
            failed_login_count=0,
            is_active=True,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        return jsonify(_staff_dict(s)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@staff_bp.route('/<int:staff_id>', methods=['PUT'])
@require_auth(roles=['manager', 'admin'])
def update_staff(staff_id):
    data = request.get_json(silent=True) or {}
    db = db_session()
    try:
        s = db.query(Staff).filter(Staff.id == staff_id).first()
        if not s:
            return jsonify({'error': 'Staff not found'}), 404

        if 'display_name' in data:
            s.display_name = data['display_name']
        if 'role' in data:
            if data['role'] not in ('cashier', 'manager', 'admin'):
                return jsonify({'error': 'Invalid role'}), 400
            s.role = data['role']
        if 'is_active' in data:
            s.is_active = bool(data['is_active'])

        s.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(s)
        return jsonify(_staff_dict(s)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@staff_bp.route('/<int:staff_id>/change-pin', methods=['POST'])
@require_auth(roles=['manager', 'admin'])
def change_pin(staff_id):
    data = request.get_json(silent=True) or {}
    pin = data.get('pin')
    if not pin:
        return jsonify({'error': 'pin is required'}), 400

    db = db_session()
    try:
        s = db.query(Staff).filter(Staff.id == staff_id).first()
        if not s:
            return jsonify({'error': 'Staff not found'}), 404

        s.pin_hash = hash_pin(str(pin))
        s.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({'message': 'PIN updated'}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@staff_bp.route('/<int:staff_id>', methods=['DELETE'])
@require_auth(roles=['admin'])
def delete_staff(staff_id):
    caller_id = request.staff['sub']
    if caller_id == staff_id:
        return jsonify({'error': 'Cannot delete your own account'}), 400

    db = db_session()
    try:
        s = db.query(Staff).filter(Staff.id == staff_id).first()
        if not s:
            return jsonify({'error': 'Staff not found'}), 404

        s.is_active = False
        s.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({'message': 'Staff deactivated'}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
