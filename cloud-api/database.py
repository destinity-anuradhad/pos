import os
from sqlalchemy import create_engine
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


def init_db():
    import models.models  # noqa: F401 — ensures models are registered with Base
    Base.metadata.create_all(bind=_engine)
    _seed_if_empty()


def _seed_if_empty():
    db = get_db()
    try:
        from models.models import Category, Product, Outlet
        if db.query(Outlet).count() == 0:
            default_outlet = Outlet(name='Main Outlet', code='MAIN-01', address='')
            db.add(default_outlet)
            db.commit()
        if db.query(Category).count() == 0:
            cats = [
                Category(name='Food', color='#f97316'),
                Category(name='Beverages', color='#06b6d4'),
                Category(name='Desserts', color='#ec4899'),
            ]
            for c in cats:
                db.add(c)
            db.commit()
            for c in cats:
                db.refresh(c)
            products = [
                Product(name='Rice & Curry', category_id=cats[0].id, price_lkr=450, price_usd=1.5),
                Product(name='Kottu', category_id=cats[0].id, price_lkr=550, price_usd=1.8),
                Product(name='Tea', category_id=cats[1].id, price_lkr=80, price_usd=0.3),
                Product(name='Coffee', category_id=cats[1].id, price_lkr=150, price_usd=0.5),
            ]
            for p in products:
                db.add(p)
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
