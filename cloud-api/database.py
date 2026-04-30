import os
from sqlalchemy import create_engine, text
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
        ('outlets',           'timezone',                "VARCHAR(50) DEFAULT 'Asia/Colombo'", 'TEXT DEFAULT \'Asia/Colombo\''),
        ('outlets',           'currency',                "VARCHAR(10) DEFAULT 'LKR'", 'TEXT DEFAULT \'LKR\''),
        ('outlets',           'vat_registration_no',     'VARCHAR(50)',         'TEXT'),
        ('outlets',           'vat_rate',                'NUMERIC(5,2) DEFAULT 18.00', 'REAL DEFAULT 18.0'),
        ('outlets',           'invoice_prefix',          "VARCHAR(20) DEFAULT ''", 'TEXT DEFAULT \'\''),
        ('outlets',           'is_active',               'BOOLEAN DEFAULT TRUE', 'INTEGER DEFAULT 1'),
        ('outlets',           'updated_at',              'TIMESTAMPTZ',        'TEXT'),
        ('terminals',         'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('terminals',         'terminal_name',           "VARCHAR(200) DEFAULT ''", 'TEXT DEFAULT \'\''),
        ('terminals',         'device_uuid',             'VARCHAR(100)',        'TEXT'),
        ('terminals',         'platform',                "VARCHAR(50) DEFAULT 'web'", 'TEXT DEFAULT \'web\''),
        ('terminals',         'api_key_hash',            "VARCHAR(255) DEFAULT ''", 'TEXT DEFAULT \'\''),
        ('terminals',         'last_seen_at',            'TIMESTAMPTZ',        'TEXT'),
        ('terminals',         'last_sync_at',            'TIMESTAMPTZ',        'TEXT'),
        ('terminals',         'last_ip',                 'VARCHAR(50)',         'TEXT'),
        ('terminals',         'is_active',               'BOOLEAN DEFAULT TRUE', 'INTEGER DEFAULT 1'),
        ('terminals',         'registered_at',           'TIMESTAMPTZ',        'TEXT'),
        ('terminals',         'registered_by_staff_id',  'BIGINT',             'INTEGER'),
        ('terminals',         'updated_at',              'TIMESTAMPTZ',        'TEXT'),
        # staff
        ('staff',             'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('staff',             'outlet_id',               'BIGINT',             'INTEGER'),
        ('staff',             'display_name',            'VARCHAR(200)',        'TEXT'),
        ('staff',             'role',                    "VARCHAR(20) DEFAULT 'cashier'", 'TEXT DEFAULT \'cashier\''),
        ('staff',             'pin_hash',                'VARCHAR(255)',        'TEXT'),
        ('staff',             'password_hash',           'VARCHAR(255)',        'TEXT'),
        ('staff',             'email',                   'VARCHAR(255)',        'TEXT'),
        ('staff',             'phone',                   'VARCHAR(30)',         'TEXT'),
        ('staff',             'failed_login_count',      'INTEGER DEFAULT 0',   'INTEGER DEFAULT 0'),
        ('staff',             'locked_until',            'TIMESTAMPTZ',        'TEXT'),
        ('staff',             'last_login_at',           'TIMESTAMPTZ',        'TEXT'),
        ('staff',             'last_login_terminal_id',  'BIGINT',             'INTEGER'),
        ('staff',             'is_active',               'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('staff',             'updated_at',              'TIMESTAMPTZ',        'TEXT'),
        # categories
        ('categories',        'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('categories',        'outlet_id',               'BIGINT',             'INTEGER'),
        ('categories',        'color',                   "VARCHAR(20) DEFAULT '#6b7280'", 'TEXT DEFAULT \'#6b7280\''),
        ('categories',        'icon',                    'VARCHAR(50)',         'TEXT'),
        ('categories',        'sort_order',              'INTEGER DEFAULT 0',   'INTEGER DEFAULT 0'),
        ('categories',        'is_active',               'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('categories',        'created_by_staff_id',     'BIGINT',             'INTEGER'),
        ('categories',        'updated_at',              'TIMESTAMPTZ',        'TEXT'),
        # products
        ('products',          'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('products',          'sku',                     'VARCHAR(100)',        'TEXT'),
        ('products',          'description',             'TEXT',               'TEXT'),
        ('products',          'barcode',                 'VARCHAR(100)',        'TEXT'),
        ('products',          'image_url',               'VARCHAR(500)',        'TEXT'),
        ('products',          'default_price_lkr',       'NUMERIC(14,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('products',          'default_price_usd',       'NUMERIC(14,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('products',          'default_cost',            'NUMERIC(14,2)',       'REAL'),
        ('products',          'vat_rate_override',       'NUMERIC(5,2)',        'REAL'),
        ('products',          'unit',                    "VARCHAR(20) DEFAULT 'pcs'", 'TEXT DEFAULT \'pcs\''),
        ('products',          'is_taxable',              'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('products',          'track_stock',             'BOOLEAN DEFAULT FALSE','INTEGER DEFAULT 0'),
        ('products',          'is_active',               'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('products',          'created_by_staff_id',     'BIGINT',             'INTEGER'),
        ('products',          'updated_at',              'TIMESTAMPTZ',        'TEXT'),
        # outlet_categories
        ('outlet_categories', 'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('outlet_categories', 'is_visible',              'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('outlet_categories', 'sort_order_override',     'INTEGER',            'INTEGER'),
        ('outlet_categories', 'updated_at',              'TIMESTAMPTZ',        'TEXT'),
        # outlet_products
        ('outlet_products',   'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('outlet_products',   'outlet_id',               'BIGINT',             'INTEGER'),
        ('outlet_products',   'price_lkr_override',      'NUMERIC(14,2)',       'REAL'),
        ('outlet_products',   'price_usd_override',      'NUMERIC(14,2)',       'REAL'),
        ('outlet_products',   'cost_override',           'NUMERIC(14,2)',       'REAL'),
        ('outlet_products',   'stock_quantity',          'NUMERIC(14,3) DEFAULT 0', 'REAL DEFAULT 0'),
        ('outlet_products',   'reorder_threshold',       'NUMERIC(14,3)',       'REAL'),
        ('outlet_products',   'vat_rate',                'NUMERIC(5,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('outlet_products',   'is_available',            'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('outlet_products',   'last_stock_update_at',    'TIMESTAMPTZ',        'TEXT'),
        ('outlet_products',   'updated_at',              'TIMESTAMPTZ',        'TEXT'),
        # tables
        ('tables',            'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('tables',            'outlet_id',               'BIGINT',             'INTEGER'),
        ('tables',            'assigned_terminal_id',    'BIGINT',             'INTEGER'),
        ('tables',            'capacity',                'INTEGER DEFAULT 4',   'INTEGER DEFAULT 4'),
        ('tables',            'section',                 'VARCHAR(50)',         'TEXT'),
        ('tables',            'is_active',               'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('tables',            'updated_at',              'TIMESTAMPTZ',        'TEXT'),
        # customers
        ('customers',         'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('customers',         'outlet_id',               'BIGINT',             'INTEGER'),
        ('customers',         'phone',                   'VARCHAR(30)',         'TEXT'),
        ('customers',         'email',                   'VARCHAR(255)',        'TEXT'),
        ('customers',         'total_spent',             'NUMERIC(12,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('customers',         'visit_count',             'INTEGER DEFAULT 0',   'INTEGER DEFAULT 0'),
        ('customers',         'is_active',               'BOOLEAN DEFAULT TRUE','INTEGER DEFAULT 1'),
        ('customers',         'updated_at',              'TIMESTAMPTZ',        'TEXT'),
        # orders
        ('orders',            'uuid',                    'VARCHAR(100)',        'TEXT'),
        ('orders',            'outlet_id',               'BIGINT',             'INTEGER'),
        ('orders',            'terminal_id',             'BIGINT',             'INTEGER'),
        ('orders',            'created_by_staff_id',     'BIGINT',             'INTEGER'),
        ('orders',            'customer_id',             'BIGINT',             'INTEGER'),
        ('orders',            'table_uuid',              'VARCHAR(100)',        'TEXT'),
        ('orders',            'table_name',              'VARCHAR(100)',        'TEXT'),
        ('orders',            'tax_invoice_no',          'VARCHAR(50)',         'TEXT'),
        ('orders',            'tax_invoice_issued_at',   'TIMESTAMPTZ',        'TEXT'),
        ('orders',            'currency',                "VARCHAR(10) DEFAULT 'LKR'", 'TEXT DEFAULT \'LKR\''),
        ('orders',            'subtotal',                'NUMERIC(14,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('orders',            'discount_amount',         'NUMERIC(14,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('orders',            'discount_reason',         'VARCHAR(200)',        'TEXT'),
        ('orders',            'service_charge',          'NUMERIC(14,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('orders',            'tax_amount',              'NUMERIC(14,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('orders',            'paid_amount',             'NUMERIC(14,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('orders',            'change_amount',           'NUMERIC(14,2) DEFAULT 0', 'REAL DEFAULT 0'),
        ('orders',            'status',                  "VARCHAR(20) DEFAULT 'completed'", 'TEXT DEFAULT \'completed\''),
        ('orders',            'void_reason',             'VARCHAR(200)',        'TEXT'),
        ('orders',            'voided_by_staff_id',      'BIGINT',             'INTEGER'),
        ('orders',            'notes',                   'TEXT',               'TEXT'),
        ('orders',            'order_created_at',        'TIMESTAMPTZ',        'TEXT'),
        ('orders',            'synced_at',               'TIMESTAMPTZ',        'TEXT'),
        ('orders',            'updated_at',              'TIMESTAMPTZ',        'TEXT'),
        # sync_logs
        ('sync_logs',         'outlet_id',               'BIGINT',             'INTEGER'),
        ('sync_logs',         'terminal_id',             'BIGINT',             'INTEGER'),
        ('sync_logs',         'terminal_code',           "VARCHAR(100) DEFAULT ''", 'TEXT DEFAULT \'\''),
        ('sync_logs',         'duration_ms',             'INTEGER',            'INTEGER'),
        ('sync_logs',         'ip_address',              'VARCHAR(50)',         'TEXT'),
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
        # PostgreSQL: create a separate engine configured with AUTOCOMMIT so that
        # ALTER TABLE DDL commits immediately without needing explicit commit calls.
        # This avoids PgBouncer transaction-pooling issues and SQLAlchemy transaction state.
        import sys
        migration_engine = create_engine(
            DATABASE_URL,
            pool_size=1, max_overflow=0, pool_pre_ping=True,
            isolation_level='AUTOCOMMIT',
        )
        try:
            with migration_engine.connect() as conn:
                # Debug: show cols before migration
                before = [r[0] for r in conn.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema='public' AND table_name='outlets' "
                    "ORDER BY ordinal_position"
                )).fetchall()]
                print(f'[migrate] outlets before: {before}', flush=True)

                for table, column, pg_type, sqlite_type in migrations:
                    sql = f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {pg_type}'
                    try:
                        conn.execute(text(sql))
                        print(f'[migrate] OK: {table}.{column}', flush=True)
                    except Exception as e:
                        print(f'[migrate] ERR {table}.{column}: {e}', file=sys.stderr, flush=True)

                after = [r[0] for r in conn.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema='public' AND table_name='outlets' "
                    "ORDER BY ordinal_position"
                )).fetchall()]
                print(f'[migrate] outlets after: {after}', flush=True)
        except Exception as e:
            print(f'[migrate] FATAL: {e}', file=sys.stderr, flush=True)
        finally:
            migration_engine.dispose()


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
