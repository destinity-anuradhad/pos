import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

Base = declarative_base()

DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///cloud.db')
# Railway uses postgres:// prefix but SQLAlchemy needs postgresql://
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

_connect_args = {'check_same_thread': False} if 'sqlite' in DATABASE_URL else {}
_engine = create_engine(DATABASE_URL, connect_args=_connect_args)
_SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


def get_db():
    return _SessionLocal()


def _migrate_db():
    """Add new columns to existing tables (PostgreSQL supports ADD COLUMN IF NOT EXISTS)."""
    migrations = [
        "ALTER TABLE products    ADD COLUMN IF NOT EXISTS modified_by_terminal VARCHAR(100)",
        "ALTER TABLE categories  ADD COLUMN IF NOT EXISTS modified_by_terminal VARCHAR(100)",
        "ALTER TABLE tables      ADD COLUMN IF NOT EXISTS modified_by_terminal VARCHAR(100)",
    ]
    with _engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
            except Exception:
                pass  # column may not exist yet if table itself doesn't exist
        conn.commit()


def init_db():
    import models.models  # noqa: F401 — ensures models are registered with Base
    Base.metadata.create_all(bind=_engine)
    _migrate_db()
    _seed_if_empty()


def _seed_if_empty():
    db = get_db()
    try:
        from models.models import Outlet
        # Only create the default outlet — products/categories/tables come from
        # the admin reset-and-seed endpoint or are pushed up from terminals.
        if db.query(Outlet).count() == 0:
            db.add(Outlet(name='Main Outlet', code='MAIN-01', address=''))
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
