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
    _migrate_db()
    _seed_if_empty()


def _migrate_db():
    """Add columns that exist in the model but may be missing from an older DB schema."""
    # For PostgreSQL: ALTER TABLE ... ADD COLUMN IF NOT EXISTS (idempotent)
    # For SQLite: ADD COLUMN fails silently if column exists (caught below)
    migrations = [
        # table,              column,                    pg_type,              sqlite_type
        ('outlets',           'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('outlets',           'address',                 'TEXT',               'TEXT'),
        ('outlets',           'phone',                   'VARCHAR(30)',         'TEXT'),
        ('outlets',           'vat_registration_no',     'VARCHAR(50)',         'TEXT'),
        ('outlets',           'vat_rate',                'NUMERIC(5,2) DEFAULT 18.00', 'REAL DEFAULT 18.0'),
        ('outlets',           'invoice_prefix',          'VARCHAR(20) DEFAULT \'\'', 'TEXT DEFAULT \'\''),
        ('outlets',           'is_active',               'BOOLEAN DEFAULT TRUE', 'INTEGER DEFAULT 1'),
        ('terminals',         'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('terminals',         'terminal_name',           'VARCHAR(200) DEFAULT \'\'', 'TEXT DEFAULT \'\''),
        ('terminals',         'device_uuid',             'VARCHAR(100)',        'TEXT'),
        ('terminals',         'api_key_hash',            'VARCHAR(255) DEFAULT \'\'', 'TEXT DEFAULT \'\''),
        ('terminals',         'last_seen_at',            'TIMESTAMPTZ',        'TEXT'),
        ('terminals',         'last_sync_at',            'TIMESTAMPTZ',        'TEXT'),
        ('terminals',         'last_ip',                 'VARCHAR(50)',         'TEXT'),
        ('terminals',         'registered_by_staff_id',  'BIGINT',             'INTEGER'),
        ('staff',             'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('staff',             'outlet_id',               'BIGINT',             'INTEGER'),
        ('staff',             'display_name',            'VARCHAR(200)',        'TEXT'),
        ('staff',             'pin_hash',                'VARCHAR(255)',        'TEXT'),
        ('staff',             'password_hash',           'VARCHAR(255)',        'TEXT'),
        ('staff',             'email',                   'VARCHAR(255)',        'TEXT'),
        ('staff',             'phone',                   'VARCHAR(30)',         'TEXT'),
        ('staff',             'failed_login_count',      'INTEGER DEFAULT 0',   'INTEGER DEFAULT 0'),
        ('staff',             'locked_until',            'TIMESTAMPTZ',        'TEXT'),
        ('staff',             'last_login_at',           'TIMESTAMPTZ',        'TEXT'),
        ('staff',             'is_active',               'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('categories',        'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('categories',        'outlet_id',               'BIGINT',             'INTEGER'),
        ('products',          'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('outlet_products',   'outlet_id',               'BIGINT',             'INTEGER'),
        ('outlet_products',   'vat_rate',                'NUMERIC(5,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('outlet_products',   'is_available',            'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('tables',            'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('tables',            'outlet_id',               'BIGINT',             'INTEGER'),
        ('tables',            'assigned_terminal_id',    'BIGINT',             'INTEGER'),
        ('tables',            'section',                 'VARCHAR(50)',         'TEXT'),
        ('tables',            'is_active',               'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('customers',         'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('customers',         'outlet_id',               'BIGINT',             'INTEGER'),
        ('customers',         'email',                   'VARCHAR(255)',        'TEXT'),
        ('customers',         'total_spent',             'NUMERIC(12,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('customers',         'visit_count',             'INTEGER DEFAULT 0',   'INTEGER DEFAULT 0'),
        ('customers',         'is_active',               'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('orders',            'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('orders',            'outlet_id',               'BIGINT',             'INTEGER'),
        ('orders',            'terminal_id',             'BIGINT',             'INTEGER'),
        ('orders',            'subtotal',                'NUMERIC(12,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('orders',            'discount_amount',         'NUMERIC(12,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('orders',            'service_charge',          'NUMERIC(12,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('orders',            'tax_amount',              'NUMERIC(12,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('orders',            'void_reason',             'VARCHAR(200)',        'TEXT'),
        ('orders',            'tax_invoice_no',          'VARCHAR(50)',         'TEXT'),
        ('orders',            'notes',                   'TEXT',               'TEXT'),
    ]
    if _is_sqlite:
        with engine.connect() as conn:
            for table, column, pg_type, sqlite_type in migrations:
                sql = f'ALTER TABLE {table} ADD COLUMN {column} {sqlite_type}'
                try:
                    conn.execute(text(sql))
                    conn.commit()
                except Exception:
                    conn.rollback()
    else:
        # PostgreSQL: DDL must run in AUTOCOMMIT mode so PgBouncer (transaction-pooling)
        # doesn't silently discard the transaction, and each statement is atomic.
        with engine.connect().execution_options(isolation_level='AUTOCOMMIT') as conn:
            for table, column, pg_type, sqlite_type in migrations:
                sql = f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {pg_type}'
                try:
                    conn.execute(text(sql))
                except Exception:
                    pass  # column already exists or benign error


def _seed_if_empty():
    import uuid as _uuid
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
        else:
            # Backfill uuid for any existing outlets that have NULL uuid
            try:
                db.execute(text("UPDATE outlets SET uuid = gen_random_uuid()::text WHERE uuid IS NULL"))
                db.commit()
            except Exception:
                try:
                    # Fallback: update one by one with Python uuid
                    from models.models import Outlet as _Outlet
                    for o in db.query(_Outlet).filter(_Outlet.uuid == None).all():  # noqa: E711
                        o.uuid = str(_uuid.uuid4())
                    db.commit()
                except Exception:
                    db.rollback()
    except Exception:
        db.rollback()
    finally:
        db.close()
