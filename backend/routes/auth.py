"""Auth routes — login, logout, me."""
import bcrypt
from datetime import datetime, timezone, timedelta
from flask import Blueprint, request, jsonify

from models.models import Staff
from utils import db_session
from auth_utils import require_auth, hash_pin, verify_pin, create_token

auth_bp = Blueprint('auth', __name__)


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


def _staff_dict(s: Staff) -> dict:
    return {
        'id': s.id,
        'uuid': s.uuid,
        'username': s.username,
        'display_name': s.display_name,
        'role': s.role,
    }


@auth_bp.route('/staff', methods=['GET'])
def staff_list():
    """Public endpoint — returns minimal staff info for the login picker."""
    db = db_session()
    try:
        staff = db.query(Staff).filter(Staff.is_active == True).order_by(Staff.display_name).all()
        return jsonify([_staff_dict(s) for s in staff]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    pin = data.get('pin')
    password = data.get('password')

    if not username:
        return jsonify({'error': 'username is required'}), 400

    db = db_session()
    try:
        staff = db.query(Staff).filter(
            Staff.username == username,
            Staff.is_active == True
        ).first()

        if not staff:
            return jsonify({'error': 'Invalid credentials'}), 401

        # Check account lock
        if staff.locked_until:
            locked_until_dt = staff.locked_until
            if locked_until_dt.tzinfo is None:
                locked_until_dt = locked_until_dt.replace(tzinfo=timezone.utc)
            if locked_until_dt > _now():
                return jsonify({
                    'error': 'Account locked',
                    'locked_until': locked_until_dt.isoformat(),
                }), 423

        # Verify credentials based on role
        credential_ok = False
        if staff.role == 'cashier':
            if pin and staff.pin_hash:
                credential_ok = verify_pin(str(pin), staff.pin_hash)
            elif password and staff.password_hash:
                credential_ok = bcrypt.checkpw(password.encode(), staff.password_hash.encode())
        else:
            if password and staff.password_hash:
                credential_ok = bcrypt.checkpw(password.encode(), staff.password_hash.encode())
            elif pin and staff.pin_hash:
                credential_ok = verify_pin(str(pin), staff.pin_hash)

        if not credential_ok:
            staff.failed_login_count = (staff.failed_login_count or 0) + 1
            if staff.failed_login_count >= 5:
                staff.locked_until = _now() + timedelta(minutes=15)
            db.commit()
            return jsonify({'error': 'Invalid credentials'}), 401

        # Success — reset counters
        staff.failed_login_count = 0
        staff.locked_until = None
        db.commit()

        token = create_token(staff.id, staff.display_name, staff.role)
        return jsonify({
            'token': token,
            'staff': _staff_dict(staff),
        }), 200

    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@auth_bp.route('/logout', methods=['POST'])
@require_auth()
def logout():
    # JWT is stateless — client discards token
    return jsonify({'message': 'Logged out'}), 200


@auth_bp.route('/me', methods=['GET'])
@require_auth()
def me():
    db = db_session()
    try:
        staff = db.query(Staff).filter(Staff.id == request.staff['sub']).first()
        if not staff:
            return jsonify({'error': 'Staff not found'}), 404
        return jsonify(_staff_dict(staff)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
