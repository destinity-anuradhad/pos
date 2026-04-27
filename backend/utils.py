from flask import request
from database import get_db as _get_db

def get_mode() -> str:
    """Read X-POS-Mode header, default to restaurant."""
    return request.headers.get('X-POS-Mode', 'restaurant')

def db_session():
    """Get a DB session based on the X-POS-Mode header."""
    from database import _sessions
    mode = get_mode()
    SessionLocal = _sessions.get(mode) or _sessions['restaurant']
    return SessionLocal()
