"""JWT helpers and auth decorator (v2)."""
import jwt
import bcrypt
import secrets
from datetime import datetime, timezone, timedelta
from functools import wraps
from flask import request, jsonify

TOKEN_EXPIRE_HOURS = 4   # v2: shorter session, refreshed on activity


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


def create_token(staff_id: int, display_name: str, role: str) -> str:
    payload = {
        'sub':  staff_id,
        'name': display_name,
        'role': role,
        'iat':  datetime.now(timezone.utc),
        'exp':  datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, get_secret(), algorithm='HS256')


def decode_token(token: str) -> dict:
    return jwt.decode(token, get_secret(), algorithms=['HS256'])


# ── PIN helpers ───────────────────────────────────────────────────────────────

def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(str(pin).encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_pin(plain_pin: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(str(plain_pin).encode(), hashed.encode())
    except Exception:
        return False


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# ── Decorator ─────────────────────────────────────────────────────────────────

def require_auth(roles: list = None):
    """Decorator — verifies JWT Bearer token. Optionally restricts to roles."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            auth_header = request.headers.get('Authorization', '')
            token = auth_header.removeprefix('Bearer ').strip()
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
