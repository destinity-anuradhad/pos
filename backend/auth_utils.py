"""JWT helpers and auth decorator."""
import jwt
import bcrypt
import secrets
from datetime import datetime, timezone, timedelta
from functools import wraps
from flask import request, jsonify

TOKEN_EXPIRE_HOURS = 8

def _get_secret():
    """Get or create JWT secret stored in settings table."""
    from database import SessionLocal
    from models.models import Setting
    db = SessionLocal()
    try:
        s = db.query(Setting).filter(Setting.key == 'jwt_secret').first()
        if not s:
            secret = secrets.token_hex(32)
            db.add(Setting(key='jwt_secret', value=secret))
            db.commit()
            return secret
        return s.value
    finally:
        db.close()

_SECRET_CACHE = None

def get_secret() -> str:
    global _SECRET_CACHE
    if not _SECRET_CACHE:
        _SECRET_CACHE = _get_secret()
    return _SECRET_CACHE

def create_token(staff_id: int, name: str, role: str) -> str:
    payload = {
        'sub': staff_id,
        'name': name,
        'role': role,
        'iat': datetime.now(timezone.utc),
        'exp': datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, get_secret(), algorithm='HS256')

def decode_token(token: str) -> dict:
    return jwt.decode(token, get_secret(), algorithms=['HS256'])

def verify_pin(plain_pin: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain_pin.encode(), hashed.encode())

def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()

def require_auth(roles: list = None):
    """Decorator — verifies JWT; optionally restricts to specific roles."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            token = request.headers.get('Authorization', '').removeprefix('Bearer ').strip()
            if not token:
                return jsonify({'error': 'Unauthorized'}), 401
            try:
                payload = decode_token(token)
            except jwt.ExpiredSignatureError:
                return jsonify({'error': 'Session expired'}), 401
            except jwt.InvalidTokenError:
                return jsonify({'error': 'Unauthorized'}), 401
            if roles and payload.get('role') not in roles:
                return jsonify({'error': 'Forbidden'}), 403
            request.staff = payload
            return f(*args, **kwargs)
        return decorated
    return decorator
