import uuid as _uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Text, Float, Boolean, DateTime,
    ForeignKey, UniqueConstraint, CheckConstraint, Index
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()

def _now():
    return datetime.now(timezone.utc)

def _uuid4():
    return str(_uuid.uuid4())


class TerminalInfo(Base):
    __tablename__ = 'terminal_info'
    __table_args__ = (
        CheckConstraint('id = 1'),
    )

    id = Column(Integer, primary_key=True, default=1)
    terminal_uuid = Column(String(100), unique=True, nullable=False)
    outlet_uuid = Column(String(100), unique=True, nullable=False)
    terminal_code = Column(String(100), nullable=False)
    terminal_name = Column(String(200), nullable=False)
    outlet_code = Column(String(50), nullable=False)
    outlet_name = Column(String(200), nullable=False)
    device_uuid = Column(String(100), nullable=False)
    platform = Column(String(50), nullable=False)
    api_key_encrypted = Column(Text, nullable=False)
    currency = Column(String(10), default='LKR', nullable=False)
    vat_rate = Column(Float, default=18.0, nullable=False)
    timezone = Column(String(50), default='Asia/Colombo', nullable=False)
    invoice_prefix = Column(String(20), nullable=False)
    registered_at = Column(String(50), nullable=False)
    last_master_sync_at = Column(String(50), nullable=True)
    last_tx_sync_at = Column(String(50), nullable=True)


class Staff(Base):
    __tablename__ = 'staff'
    __table_args__ = (
        Index('idx_staff_uuid', 'uuid'),
        Index('idx_staff_username', 'username'),
        Index('idx_staff_active', 'is_active'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    username = Column(String(100), nullable=False)
    display_name = Column(String(200), nullable=False)
    role = Column(String(20), nullable=False, default='cashier')
    pin_hash = Column(String(255), nullable=True)
    password_hash = Column(String(255), nullable=True)
    failed_login_count = Column(Integer, default=0, nullable=False)
    locked_until = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    updated_at = Column(String(50), nullable=True)
    synced_at = Column(String(50), nullable=True)


class Setting(Base):
    __tablename__ = 'settings'

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(200), unique=True, nullable=False)
    value = Column(Text, nullable=True)
    is_secret = Column(Boolean, default=False, nullable=False)
    updated_at = Column(String(50), nullable=True)


class SyncSettings(Base):
    __tablename__ = 'sync_settings'
    __table_args__ = (
        CheckConstraint('id = 1'),
    )

    id = Column(Integer, primary_key=True, default=1)
    sync_interval_minutes = Column(Integer, default=10, nullable=False)
    auto_sync_enabled = Column(Boolean, default=True, nullable=False)
    last_master_sync_at = Column(String(50), nullable=True)
    last_tx_sync_at = Column(String(50), nullable=True)
    cloud_base_url = Column(String(500), nullable=False, default='')
    updated_at = Column(String(50), nullable=True)


class SyncLog(Base):
    __tablename__ = 'sync_log'
    __table_args__ = (
        Index('idx_sync_log_started', 'started_at'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    sync_type = Column(String(30), nullable=False)
    direction = Column(String(10), nullable=False)
    status = Column(String(20), nullable=False)
    records_affected = Column(Integer, default=0, nullable=False)
    duration_ms = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(String(50), nullable=False)
    finished_at = Column(String(50), nullable=True)


class TableStatus(Base):
    __tablename__ = 'table_statuses'

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(50), unique=True, nullable=False)
    label = Column(String(100), nullable=False)
    color = Column(String(20), default='#64748b', nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    is_system = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    tables = relationship('RestaurantTable', back_populates='table_status')
    transitions_from = relationship(
        'TableStatusTransition',
        foreign_keys='TableStatusTransition.from_status_id',
        back_populates='from_status'
    )
    transitions_to = relationship(
        'TableStatusTransition',
        foreign_keys='TableStatusTransition.to_status_id',
        back_populates='to_status'
    )


class TableStatusTransition(Base):
    __tablename__ = 'table_status_transitions'

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_status_id = Column(Integer, ForeignKey('table_statuses.id'), nullable=False)
    to_status_id = Column(Integer, ForeignKey('table_statuses.id'), nullable=False)
    trigger_type = Column(String(20), nullable=False)
    trigger_event = Column(String(100), nullable=True)

    from_status = relationship(
        'TableStatus',
        foreign_keys=[from_status_id],
        back_populates='transitions_from'
    )
    to_status = relationship(
        'TableStatus',
        foreign_keys=[to_status_id],
        back_populates='transitions_to'
    )


class Category(Base):
    __tablename__ = 'categories'
    __table_args__ = (
        Index('idx_cat_uuid', 'uuid'),
        Index('idx_cat_visible', 'is_visible', 'sort_order'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    name = Column(String(200), nullable=False)
    color = Column(String(20), default='#6b7280', nullable=False)
    icon = Column(String(50), nullable=True)
    sort_order = Column(Integer, default=0, nullable=False)
    is_visible = Column(Boolean, default=True, nullable=False)
    updated_at = Column(String(50), nullable=True)
    synced_at = Column(String(50), nullable=True)

    products = relationship('Product', back_populates='category')


class Product(Base):
    __tablename__ = 'products'
    __table_args__ = (
        Index('idx_prod_uuid', 'uuid'),
        Index('idx_prod_op_uuid', 'outlet_product_uuid'),
        Index('idx_prod_category', 'category_id'),
        Index('idx_prod_name', 'name'),
        Index('idx_prod_barcode', 'barcode'),
        Index('idx_prod_available', 'is_available'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    outlet_product_uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    category_id = Column(Integer, ForeignKey('categories.id'), nullable=True)
    name = Column(String(200), nullable=False)
    sku = Column(String(100), nullable=True)
    barcode = Column(String(100), nullable=True)
    image_url = Column(String(500), nullable=True)
    price_lkr = Column(Float, default=0, nullable=False)
    price_usd = Column(Float, default=0, nullable=False)
    vat_rate = Column(Float, default=0, nullable=False)
    unit = Column(String(20), default='pcs', nullable=False)
    track_stock = Column(Boolean, default=False, nullable=False)
    stock_quantity = Column(Float, default=0, nullable=False)
    is_available = Column(Boolean, default=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    updated_at = Column(String(50), nullable=True)
    synced_at = Column(String(50), nullable=True)

    category = relationship('Category', back_populates='products')
    stock_movements = relationship('StockMovement', back_populates='product')


class RestaurantTable(Base):
    __tablename__ = 'tables'
    __table_args__ = (
        Index('idx_tables_uuid', 'uuid'),
        Index('idx_tables_status', 'status_id'),
        Index('idx_tables_active', 'is_active'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    name = Column(String(100), nullable=False)
    capacity = Column(Integer, default=4, nullable=False)
    section = Column(String(50), nullable=True)
    status_id = Column(Integer, ForeignKey('table_statuses.id'), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    updated_at = Column(String(50), nullable=True)
    synced_at = Column(String(50), nullable=True)

    table_status = relationship('TableStatus', back_populates='tables')
    orders = relationship('Order', back_populates='table')


class Customer(Base):
    __tablename__ = 'customers'
    __table_args__ = (
        Index('idx_cust_uuid', 'uuid'),
        Index('idx_cust_phone', 'phone'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    phone = Column(String(30), nullable=True)
    name = Column(String(200), nullable=True)
    loyalty_card_no = Column(String(50), nullable=True)
    loyalty_points = Column(Integer, default=0, nullable=False)
    notes = Column(Text, nullable=True)
    updated_at = Column(String(50), nullable=True)
    synced_at = Column(String(50), nullable=True)
    sync_status = Column(String(20), default='synced', nullable=False)

    orders = relationship('Order', back_populates='customer')


class Order(Base):
    __tablename__ = 'orders'
    __table_args__ = (
        Index('idx_orders_uuid', 'uuid'),
        Index('idx_orders_ref', 'terminal_order_ref'),
        Index('idx_orders_status', 'status'),
        Index('idx_orders_date', 'order_created_at'),
        Index('idx_orders_table', 'table_id'),
        Index('idx_orders_sync', 'sync_status'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    staff_id = Column(Integer, ForeignKey('staff.id'), nullable=True)
    customer_id = Column(Integer, ForeignKey('customers.id'), nullable=True)
    table_id = Column(Integer, ForeignKey('tables.id'), nullable=True)
    terminal_order_ref = Column(String(100), unique=True, nullable=False)
    tax_invoice_no = Column(String(50), nullable=True)
    currency = Column(String(10), default='LKR', nullable=False)
    subtotal = Column(Float, default=0, nullable=False)
    discount_amount = Column(Float, default=0, nullable=False)
    discount_reason = Column(String(200), nullable=True)
    service_charge = Column(Float, default=0, nullable=False)
    tax_amount = Column(Float, default=0, nullable=False)
    total_amount = Column(Float, default=0, nullable=False)
    paid_amount = Column(Float, default=0, nullable=False)
    change_amount = Column(Float, default=0, nullable=False)
    status = Column(String(20), default='pending', nullable=False)
    void_reason = Column(String(200), nullable=True)
    voided_by_staff_id = Column(Integer, ForeignKey('staff.id'), nullable=True)
    notes = Column(Text, nullable=True)
    order_created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=True)
    sync_status = Column(String(20), default='pending', nullable=False)
    sync_attempts = Column(Integer, default=0, nullable=False)
    sync_error = Column(Text, nullable=True)
    synced_at = Column(String(50), nullable=True)
    receipt_printed = Column(Boolean, default=False, nullable=False)
    receipt_sent = Column(Boolean, default=False, nullable=False)  # legacy compat — old DB column

    staff = relationship('Staff', foreign_keys=[staff_id])
    voided_by = relationship('Staff', foreign_keys=[voided_by_staff_id])
    table = relationship('RestaurantTable', back_populates='orders')
    customer = relationship('Customer', back_populates='orders')
    items = relationship('OrderItem', back_populates='order', cascade='all, delete-orphan')
    payments = relationship('Payment', back_populates='order', cascade='all, delete-orphan')


class OrderItem(Base):
    __tablename__ = 'order_items'
    __table_args__ = (
        Index('idx_oi_uuid', 'uuid'),
        Index('idx_oi_order', 'order_id'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    order_id = Column(Integer, ForeignKey('orders.id'), nullable=False)
    product_uuid = Column(String(100), nullable=True)
    product_id = Column(Integer, nullable=True)
    product_name = Column(String(200), nullable=False)
    product_sku = Column(String(100), nullable=True)
    quantity = Column(Float, default=1, nullable=False)
    unit_price = Column(Float, default=0, nullable=False)
    discount_amount = Column(Float, default=0, nullable=False)
    vat_rate = Column(Float, default=0, nullable=False)
    vat_amount = Column(Float, default=0, nullable=False)
    line_total = Column(Float, default=0, nullable=False)
    notes = Column(String(500), nullable=True)
    created_at = Column(String(50), nullable=False)

    order = relationship('Order', back_populates='items')


class Payment(Base):
    __tablename__ = 'payments'
    __table_args__ = (
        Index('idx_pay_uuid', 'uuid'),
        Index('idx_pay_order', 'order_id'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    order_id = Column(Integer, ForeignKey('orders.id'), nullable=False)
    payment_method = Column(String(30), nullable=False)
    amount = Column(Float, default=0, nullable=False)
    currency = Column(String(10), default='LKR', nullable=False)
    card_last4 = Column(String(4), nullable=True)
    card_brand = Column(String(20), nullable=True)
    transaction_ref = Column(String(200), nullable=True)
    status = Column(String(20), default='success', nullable=False)
    paid_at = Column(String(50), nullable=False)

    order = relationship('Order', back_populates='payments')


class StockMovement(Base):
    __tablename__ = 'stock_movements'
    __table_args__ = (
        Index('idx_sm_uuid', 'uuid'),
        Index('idx_sm_product_date', 'product_id'),
        Index('idx_sm_sync', 'sync_status'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    product_id = Column(Integer, ForeignKey('products.id'), nullable=False)
    product_uuid = Column(String(100), nullable=False)
    outlet_product_uuid = Column(String(100), nullable=False)
    staff_id = Column(Integer, ForeignKey('staff.id'), nullable=True)
    movement_type = Column(String(30), nullable=False)
    quantity_change = Column(Float, nullable=False)
    stock_after = Column(Float, default=0, nullable=False)
    unit_cost = Column(Float, nullable=True)
    reference_type = Column(String(30), nullable=True)
    reference_uuid = Column(String(100), nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(String(50), nullable=False)
    sync_status = Column(String(20), default='pending', nullable=False)
    synced_at = Column(String(50), nullable=True)

    product = relationship('Product', back_populates='stock_movements')
    staff = relationship('Staff')


class AuditLog(Base):
    __tablename__ = 'audit_log'
    __table_args__ = (
        Index('idx_audit_uuid', 'uuid'),
        Index('idx_audit_action_date', 'action', 'occurred_at'),
        Index('idx_audit_sync', 'sync_status'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    staff_id = Column(Integer, ForeignKey('staff.id'), nullable=True)
    action = Column(String(50), nullable=False)
    entity_type = Column(String(50), nullable=True)
    entity_uuid = Column(String(100), nullable=True)
    details_json = Column(Text, nullable=True)
    occurred_at = Column(String(50), nullable=False)
    sync_status = Column(String(20), default='pending', nullable=False)
    synced_at = Column(String(50), nullable=True)
