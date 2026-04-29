import uuid as uuid_lib
from datetime import datetime, timezone

import bcrypt
from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Staff

staff_bp = Blueprint('staff', __name__)


def _staff_to_dict(s):
    return {
        'id': s.id,
        'uuid': str(s.uuid),
        'outlet_id': s.outlet_id,
        'username': s.username,
        'display_name': s.display_name,
        'role': s.role,
        'email': s.email,
        'phone': s.phone,
        'failed_login_count': s.failed_login_count,
        'locked_until': s.locked_until.isoformat() if s.locked_until else None,
        'last_login_at': s.last_login_at.isoformat() if s.last_login_at else None,
        'is_active': s.is_active,
        'created_at': s.created_at.isoformat() if s.created_at else None,
        'updated_at': s.updated_at.isoformat() if s.updated_at else None,
    }


def _hash_secret(secret: str) -> str:
    return bcrypt.hashpw(secret.encode(), bcrypt.gensalt()).decode()


@staff_bp.route('/', methods=['GET'])
def list_staff():
    db = get_db()
    try:
        outlet_id = request.args.get('outlet_id', type=int)
        q = db.query(Staff)
        if outlet_id:
            q = q.filter(Staff.outlet_id == outlet_id)
        staff_list = q.order_by(Staff.display_name).all()
        return jsonify([_staff_to_dict(s) for s in staff_list])
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@staff_bp.route('/', methods=['POST'])
def create_staff():
    db = get_db()
    try:
        data = request.get_json(silent=True) or {}

        username = (data.get('username') or '').strip()
        display_name = (data.get('display_name') or '').strip()
        role = (data.get('role') or 'cashier').strip()

        if not username:
            return jsonify({'error': 'username is required'}), 400
        if not display_name:
            return jsonify({'error': 'display_name is required'}), 400

        existing = db.query(Staff).filter(Staff.username == username).first()
        if existing:
            return jsonify({'error': f"Username '{username}' already exists"}), 409

        pin_hash = None
        password_hash = None
        if data.get('pin'):
            pin_hash = _hash_secret(str(data['pin']))
        if data.get('password'):
            password_hash = _hash_secret(data['password'])

        now = datetime.now(timezone.utc)
        staff = Staff(
            uuid=str(uuid_lib.uuid4()),
            outlet_id=data.get('outlet_id'),
            username=username,
            display_name=display_name,
            role=role,
            pin_hash=pin_hash,
            password_hash=password_hash,
            email=data.get('email'),
            phone=data.get('phone'),
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(staff)
        db.commit()
        db.refresh(staff)
        return jsonify(_staff_to_dict(staff)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@staff_bp.route('/<int:id>', methods=['PUT'])
def update_staff(id):
    db = get_db()
    try:
        staff = db.query(Staff).filter(Staff.id == id).first()
        if not staff:
            return jsonify({'error': 'Staff not found'}), 404

        data = request.get_json(silent=True) or {}
        for field in ('display_name', 'role', 'email', 'phone', 'is_active'):
            if field in data:
                setattr(staff, field, data[field])

        staff.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(staff)
        return jsonify(_staff_to_dict(staff))
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@staff_bp.route('/<int:id>/reset-pin', methods=['POST'])
def reset_pin(id):
    db = get_db()
    try:
        staff = db.query(Staff).filter(Staff.id == id).first()
        if not staff:
            return jsonify({'error': 'Staff not found'}), 404

        data = request.get_json(silent=True) or {}
        pin = data.get('pin')
        if not pin:
            return jsonify({'error': 'pin is required'}), 400

        staff.pin_hash = _hash_secret(str(pin))
        staff.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({'message': 'PIN updated successfully'})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@staff_bp.route('/<int:id>/reset-password', methods=['POST'])
def reset_password(id):
    db = get_db()
    try:
        staff = db.query(Staff).filter(Staff.id == id).first()
        if not staff:
            return jsonify({'error': 'Staff not found'}), 404

        data = request.get_json(silent=True) or {}
        password = data.get('password')
        if not password:
            return jsonify({'error': 'password is required'}), 400

        staff.password_hash = _hash_secret(password)
        staff.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({'message': 'Password updated successfully'})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
