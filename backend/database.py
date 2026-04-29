"""Local SQLite database setup — dual-DB routing (restaurant / retail)."""
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from models.models import Base, TableStatus, TableStatusTransition, SyncSettings

_DB_PATH = os.environ.get('DB_PATH', '.')
_RESTAURANT_URL = f'sqlite:///{_DB_PATH}/restaurant.db'
_RETAIL_URL     = f'sqlite:///{_DB_PATH}/retail.db'

_engines = {
    'restaurant': create_engine(_RESTAURANT_URL, connect_args={'check_same_thread': False}),
    'retail':     create_engine(_RETAIL_URL,     connect_args={'check_same_thread': False}),
}

_session_factories = {
    k: sessionmaker(autocommit=False, autoflush=False, bind=e)
    for k, e in _engines.items()
}

# Legacy aliases used by utils.py and auth_utils.py
_SessionLocal = _session_factories['restaurant']
SessionLocal  = _session_factories['restaurant']


def get_mode() -> str:
    from flask import request
    return request.headers.get('X-POS-Mode', 'restaurant').lower()


def db_session():
    """Return a session for the mode specified by X-POS-Mode header."""
    return _session_factories.get(get_mode(), _session_factories['restaurant'])()


def init_db():
    for engine in _engines.values():
        Base.metadata.create_all(engine)
        _migrate_db(engine)      # add missing columns to existing DBs first
        _seed_if_empty(engine)   # then seed default data if tables are empty


def _seed_if_empty(engine):
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        if db.query(TableStatus).count() == 0:
            statuses = [
                TableStatus(code='available', label='Available', color='#22c55e', sort_order=0, is_system=True),
                TableStatus(code='reserved',  label='Reserved',  color='#06b6d4', sort_order=1, is_system=True),
                TableStatus(code='seated',    label='Seated',    color='#3b82f6', sort_order=2, is_system=True),
                TableStatus(code='ordered',   label='Ordered',   color='#f59e0b', sort_order=3, is_system=True),
                TableStatus(code='billed',    label='Billed',    color='#ef4444', sort_order=4, is_system=True),
                TableStatus(code='cleaning',  label='Cleaning',  color='#a855f7', sort_order=5, is_system=True),
            ]
            db.add_all(statuses)
            db.flush()

            # Map code → id
            status_ids = {s.code: s.id for s in statuses}

            transitions = [
                # manual
                TableStatusTransition(from_status_id=status_ids['available'], to_status_id=status_ids['seated'],   trigger_type='manual', trigger_event='staff_action'),
                TableStatusTransition(from_status_id=status_ids['available'], to_status_id=status_ids['reserved'], trigger_type='manual', trigger_event='staff_action'),
                TableStatusTransition(from_status_id=status_ids['reserved'],  to_status_id=status_ids['seated'],   trigger_type='manual', trigger_event='staff_action'),
                TableStatusTransition(from_status_id=status_ids['reserved'],  to_status_id=status_ids['available'],trigger_type='manual', trigger_event='staff_action'),
                TableStatusTransition(from_status_id=status_ids['cleaning'],  to_status_id=status_ids['available'],trigger_type='manual', trigger_event='staff_action'),
                # auto
                TableStatusTransition(from_status_id=status_ids['seated'],  to_status_id=status_ids['ordered'], trigger_type='auto', trigger_event='first_item_added'),
                TableStatusTransition(from_status_id=status_ids['ordered'], to_status_id=status_ids['billed'],  trigger_type='auto', trigger_event='checkout_clicked'),
                TableStatusTransition(from_status_id=status_ids['billed'],  to_status_id=status_ids['cleaning'],trigger_type='auto', trigger_event='payment_confirmed'),
            ]
            db.add_all(transitions)

        if db.query(SyncSettings).count() == 0:
            db.add(SyncSettings(id=1, cloud_base_url=''))

        db.commit()

        # Seed default staff separately — uses raw SQL to handle legacy 'name NOT NULL' column
        if db.query(Staff).count() == 0:
            import bcrypt as _bcrypt, uuid as _uuid
            pw_hash  = _bcrypt.hashpw(b'admin123', _bcrypt.gensalt()).decode()
            pin_hash = _bcrypt.hashpw(b'1234',     _bcrypt.gensalt()).decode()
            try:
                db.execute(text('''
                    INSERT INTO staff (uuid, username, display_name, name, role, password_hash, is_active, failed_login_count)
                    VALUES (:uuid, :username, :display_name, :display_name, :role, :password_hash, 1, 0)
                '''), {'uuid': str(_uuid.uuid4()), 'username': 'admin', 'display_name': 'Admin',
                       'role': 'admin', 'password_hash': pw_hash})
                db.execute(text('''
                    INSERT INTO staff (uuid, username, display_name, name, role, pin_hash, is_active, failed_login_count)
                    VALUES (:uuid, :username, :display_name, :display_name, :role, :pin_hash, 1, 0)
                '''), {'uuid': str(_uuid.uuid4()), 'username': 'cashier1', 'display_name': 'Cashier 1',
                       'role': 'cashier', 'pin_hash': pin_hash})
                db.commit()
            except Exception:
                db.rollback()  # legacy DB issue — skip staff seed, don't crash app
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _migrate_db(engine):
    """Safely add columns that may not exist in older DB files."""
    migrations = [
        ('staff',            'uuid',               'TEXT'),
        ('staff',            'display_name',        'TEXT'),
        ('staff',            'username',            'TEXT'),
        ('staff',            'password_hash',       'TEXT'),
        ('staff',            'failed_login_count',  'INTEGER DEFAULT 0'),
        ('staff',            'locked_until',        'TEXT'),
        ('orders',           'uuid',                'TEXT'),
        ('orders',           'subtotal',            'REAL DEFAULT 0'),
        ('orders',           'discount_amount',     'REAL DEFAULT 0'),
        ('orders',           'discount_reason',     'TEXT'),
        ('orders',           'service_charge',      'REAL DEFAULT 0'),
        ('orders',           'tax_amount',          'REAL DEFAULT 0'),
        ('orders',           'paid_amount',         'REAL DEFAULT 0'),
        ('orders',           'change_amount',       'REAL DEFAULT 0'),
        ('orders',           'void_reason',         'TEXT'),
        ('orders',           'voided_by_staff_id',  'INTEGER'),
        ('orders',           'notes',               'TEXT'),
        ('orders',           'order_created_at',    'TEXT'),
        ('orders',           'sync_attempts',       'INTEGER DEFAULT 0'),
        ('orders',           'sync_error',          'TEXT'),
        ('orders',           'tax_invoice_no',      'TEXT'),
        ('orders',           'receipt_printed',     'INTEGER DEFAULT 0'),
        ('order_items',      'uuid',                'TEXT'),
        ('order_items',      'product_uuid',        'TEXT'),
        ('order_items',      'product_sku',         'TEXT'),
        ('order_items',      'discount_amount',     'REAL DEFAULT 0'),
        ('order_items',      'vat_rate',            'REAL DEFAULT 0'),
        ('order_items',      'vat_amount',          'REAL DEFAULT 0'),
        ('order_items',      'line_total',          'REAL DEFAULT 0'),
        ('order_items',      'notes',               'TEXT'),
        ('order_items',      'created_at',          'TEXT'),
        ('products',         'uuid',                'TEXT'),
        ('products',         'outlet_product_uuid', 'TEXT'),
        ('products',         'vat_rate',            'REAL DEFAULT 0'),
        ('products',         'unit',                'TEXT DEFAULT "pcs"'),
        ('products',         'track_stock',         'INTEGER DEFAULT 0'),
        ('products',         'is_available',        'INTEGER DEFAULT 1'),
        ('products',         'sku',                 'TEXT'),
        ('categories',       'uuid',                'TEXT'),
        ('categories',       'icon',                'TEXT'),
        ('categories',       'sort_order',          'INTEGER DEFAULT 0'),
        ('categories',       'is_visible',          'INTEGER DEFAULT 1'),
        ('tables',           'uuid',                'TEXT'),
        ('tables',           'section',             'TEXT'),
        ('tables',           'is_active',           'INTEGER DEFAULT 1'),
        ('tables',           'updated_at',          'TEXT'),
        ('tables',           'synced_at',           'TEXT'),
        ('staff',            'name',                'TEXT'),   # old column compat
        ('staff',            'is_active',           'INTEGER DEFAULT 1'),
        ('staff',            'updated_at',          'TEXT'),
        ('staff',            'synced_at',           'TEXT'),
        ('orders',           'staff_id',            'INTEGER'),
        ('orders',           'customer_id',         'INTEGER'),
        ('orders',           'updated_at',          'TEXT'),
        ('orders',           'synced_at',           'TEXT'),
        ('categories',       'updated_at',          'TEXT'),
        ('categories',       'synced_at',           'TEXT'),
        ('products',         'updated_at',          'TEXT'),
        ('products',         'synced_at',           'TEXT'),
        ('settings',         'is_secret',           'INTEGER DEFAULT 0'),
        ('sync_settings',    'cloud_base_url',      'TEXT DEFAULT ""'),
        ('sync_settings',    'last_tx_sync_at',     'TEXT'),
    ]
    with engine.connect() as conn:
        for table, col, col_type in migrations:
            try:
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {col} {col_type}'))
                conn.commit()
            except Exception:
                pass  # column already exists
