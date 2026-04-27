from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

Base = declarative_base()

# Two engines — one per mode
_engines = {
    'restaurant': create_engine('sqlite:///./restaurant.db', connect_args={'check_same_thread': False}),
    'retail':     create_engine('sqlite:///./retail.db',     connect_args={'check_same_thread': False}),
}

_sessions = {
    mode: sessionmaker(autocommit=False, autoflush=False, bind=engine)
    for mode, engine in _engines.items()
}

def init_db():
    """Create all tables in both databases."""
    for engine in _engines.values():
        Base.metadata.create_all(bind=engine)

def get_db(mode: str = 'restaurant'):
    """Return a DB session for the given mode."""
    SessionLocal = _sessions.get(mode) or _sessions['restaurant']
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
