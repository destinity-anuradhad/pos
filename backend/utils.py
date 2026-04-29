from database import _SessionLocal


def db_session():
    """Get a DB session for the restaurant database."""
    return _SessionLocal()


def as_iso(v):
    """Return datetime as ISO string, handling both str and datetime objects."""
    if v is None:
        return None
    if isinstance(v, str):
        return v
    return v.isoformat()
