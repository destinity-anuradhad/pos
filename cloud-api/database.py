import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models.models import Base, Outlet, InvoiceCounter

DATABASE_URL = os.environ.get(
    'DATABASE_URL',
    'sqlite:///./cloud.db'  # fallback for local dev without Postgres
)

# Postgres SSL fix
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

_is_sqlite = DATABASE_URL.startswith('sqlite')
_engine_kwargs: dict = {'pool_pre_ping': True}
if _is_sqlite:
    _engine_kwargs['connect_args'] = {'check_same_thread': False}
    _engine_kwargs['implicit_returning'] = False  # BigInteger PK compat on SQLite
else:
    _engine_kwargs['pool_size'] = 5
    _engine_kwargs['max_overflow'] = 10

engine = create_engine(DATABASE_URL, **_engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    return SessionLocal()


def init_db():
    Base.metadata.create_all(bind=engine)
    _seed_if_empty()


def _seed_if_empty():
    db = SessionLocal()
    try:
        if db.query(Outlet).count() == 0:
            default_outlet = Outlet(
                uuid='00000000-0000-0000-0000-000000000001',
                code='MAIN-01',
                name='Main Outlet',
                timezone='Asia/Colombo',
                currency='LKR',
                vat_rate=18.00,
                invoice_prefix='MAIN',
            )
            db.add(default_outlet)
            db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
