import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

Base = declarative_base()

# DB_PATH env var lets cloud deployments (Railway volumes etc.) store data
# outside the ephemeral container filesystem.
_db_dir = os.environ.get('DB_PATH', '.')

_engine = create_engine(
    f'sqlite:///{_db_dir}/restaurant.db',
    connect_args={'check_same_thread': False}
)

_SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
SessionLocal  = _SessionLocal   # public alias used by auth_utils


def _add_column_if_missing(conn, table: str, column: str, definition: str):
    """ALTER TABLE … ADD COLUMN safely (SQLite doesn't support IF NOT EXISTS)."""
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    existing = [row[1] for row in rows]
    if column not in existing:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))


def _migrate_db():
    """Add any new columns that were not present in older databases."""
    with _engine.connect() as conn:
        _add_column_if_missing(conn, 'categories', 'sync_status',          "VARCHAR DEFAULT 'pending'")
        _add_column_if_missing(conn, 'categories', 'modified_by_terminal', "VARCHAR")
        _add_column_if_missing(conn, 'categories', 'created_at',           "DATETIME")
        _add_column_if_missing(conn, 'products',   'sync_status',          "VARCHAR DEFAULT 'pending'")
        _add_column_if_missing(conn, 'products',   'modified_by_terminal', "VARCHAR")
        _add_column_if_missing(conn, 'products',   'created_at',           "DATETIME")
        _add_column_if_missing(conn, 'tables',     'sync_status',          "VARCHAR DEFAULT 'pending'")
        _add_column_if_missing(conn, 'tables',     'modified_by_terminal', "VARCHAR")
        _add_column_if_missing(conn, 'tables',     'created_at',           "DATETIME")
        conn.commit()


def _seed_default_staff():
    """Create default admin account if no staff exist."""
    import bcrypt
    db = _SessionLocal()
    try:
        from models.models import Staff
        if db.query(Staff).count() == 0:
            pin_hash = bcrypt.hashpw(b'1234', bcrypt.gensalt()).decode()
            db.add(Staff(name='Admin', role='admin', pin_hash=pin_hash, is_active=True))
            db.commit()
    except Exception:
        pass
    finally:
        db.close()


def init_db():
    import models.models  # register all models in Base.metadata before create_all
    Base.metadata.create_all(bind=_engine)
    _migrate_db()
    _seed_if_empty()
    _seed_default_staff()


def get_db():
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _seed_if_empty():
    from models.models import (
        TableStatus, TableStatusTransition, SyncSettings
    )

    db = _SessionLocal()
    try:
        # ── Sync settings ────────────────────────────────────────
        if db.query(SyncSettings).count() == 0:
            db.add(SyncSettings(sync_interval_minutes=10, auto_sync_enabled=True))
            db.flush()

        # ── Table statuses ───────────────────────────────────────
        if db.query(TableStatus).count() == 0:
            statuses = [
                TableStatus(code='available', label='Available', color='#22c55e', sort_order=1, is_system=True),
                TableStatus(code='reserved',  label='Reserved',  color='#06b6d4', sort_order=2, is_system=True),
                TableStatus(code='seated',    label='Seated',    color='#3b82f6', sort_order=3, is_system=True),
                TableStatus(code='ordered',   label='Ordered',   color='#f59e0b', sort_order=4, is_system=True),
                TableStatus(code='billed',    label='Billed',    color='#ef4444', sort_order=5, is_system=True),
                TableStatus(code='cleaning',  label='Cleaning',  color='#a855f7', sort_order=6, is_system=True),
            ]
            for s in statuses:
                db.add(s)
            db.flush()

            # Build lookup by code
            status_map = {s.code: s for s in db.query(TableStatus).all()}

            # ── Transitions ──────────────────────────────────────
            transitions = [
                # Manual transitions
                ('available', 'seated',    'manual',  'staff_action'),
                ('available', 'reserved',  'manual',  'staff_action'),
                ('reserved',  'seated',    'manual',  'staff_action'),       # guests arrive
                ('reserved',  'available', 'manual',  'staff_action'),       # cancelled
                ('cleaning',  'available', 'manual',  'staff_action'),       # staff marks clean
                # Auto transitions
                ('seated',    'ordered',   'auto',    'first_item_added'),
                ('ordered',   'billed',    'auto',    'checkout_clicked'),
                ('billed',    'cleaning',  'auto',    'payment_confirmed'),
            ]
            for from_code, to_code, ttype, tevent in transitions:
                db.add(TableStatusTransition(
                    from_status_id=status_map[from_code].id,
                    to_status_id=status_map[to_code].id,
                    trigger_type=ttype,
                    trigger_event=tevent,
                ))
            db.flush()

        # Products, categories, and tables are NOT seeded here.
        # They come from cloud via "Pull Master Data" on the sync page.
        db.commit()
    finally:
        db.close()
