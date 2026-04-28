from database import _SessionLocal


def db_session():
    """Get a DB session for the restaurant database."""
    return _SessionLocal()
