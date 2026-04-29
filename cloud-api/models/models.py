import uuid as _uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, BigInteger, Integer, SmallInteger, String, Text,
    Boolean, DateTime, ForeignKey, UniqueConstraint, Index,
    Numeric
)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.sql import func

Base = declarative_base()

# BigInteger that degrades to Integer on SQLite so autoincrement PKs work
_BigInt = BigInteger().with_variant(Integer(), 'sqlite')

def _now():
    return datetime.now(timezone.utc)

def _uuid4():
    return str(_uuid.uuid4())


class Outlet(Base):
    __tablename__ = 'outlets'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    address = Column(Text, nullable=True)
    phone = Column(String(30), nullable=True)
    timezone = Column(String(50), nullable=False, default='Asia/Colombo')
    currency = Column(String(10), nullable=False, default='LKR')
    vat_registration_no = Column(String(50), nullable=True)
    vat_rate = Column(Numeric(5, 2), nullable=False, default=18.00)
    invoice_prefix = Column(String(20), nullable=False, default='')
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    terminals = relationship('Terminal', back_populates='outlet', foreign_keys='Terminal.outlet_id')
    staff = relationship('Staff', back_populates='outlet', foreign_keys='Staff.outlet_id')
    tables = relationship('Table', back_populates='outlet')
    outlet_categories = relationship('OutletCategory', back_populates='outlet')
    outlet_products = relationship('OutletProduct', back_populates='outlet')
    orders = relationship('Order', back_populates='outlet')

    __table_args__ = (
        Index('idx_outlets_uuid', 'uuid'),
        Index('idx_outlets_code', 'code'),
        Index('idx_outlets_active', 'is_active'),
    )


class Terminal(Base):
    __tablename__ = 'terminals'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    outlet_id = Column(_BigInt, ForeignKey('outlets.id', ondelete='RESTRICT'), nullable=False)
    terminal_code = Column(String(100), unique=True, nullable=False)
    terminal_name = Column(String(200), nullable=False, default='')
    device_uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    platform = Column(String(50), nullable=False, default='web')
    api_key_hash = Column(String(255), nullable=False, default='')
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    last_sync_at = Column(DateTime(timezone=True), nullable=True)
    last_ip = Column(String(50), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    registered_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    registered_by_staff_id = Column(_BigInt, ForeignKey('staff.id'), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    outlet = relationship('Outlet', back_populates='terminals', foreign_keys=[outlet_id])
    orders = relationship('Order', back_populates='terminal')
    sync_logs = relationship('SyncLog', back_populates='terminal')
    audit_logs = relationship('AuditLog', back_populates='terminal')

    __table_args__ = (
        Index('idx_terminals_uuid', 'uuid'),
        Index('idx_terminals_outlet', 'outlet_id'),
        Index('idx_terminals_device', 'device_uuid'),
        Index('idx_terminals_active', 'is_active', 'outlet_id'),
    )


class Staff(Base):
    __tablename__ = 'staff'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    outlet_id = Column(_BigInt, ForeignKey('outlets.id'), nullable=True)
    username = Column(String(100), unique=True, nullable=False)
    display_name = Column(String(200), nullable=False)
    role = Column(String(20), nullable=False, default='cashier')
    pin_hash = Column(String(255), nullable=True)
    password_hash = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(30), nullable=True)
    failed_login_count = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    last_login_terminal_id = Column(_BigInt, ForeignKey('terminals.id'), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    outlet = relationship('Outlet', back_populates='staff', foreign_keys=[outlet_id])
    orders = relationship('Order', back_populates='created_by_staff', foreign_keys='Order.created_by_staff_id')
    audit_logs = relationship('AuditLog', back_populates='staff')

    __table_args__ = (
        Index('idx_staff_uuid', 'uuid'),
        Index('idx_staff_outlet', 'outlet_id', 'is_active'),
        Index('idx_staff_username', 'username'),
        Index('idx_staff_role', 'role', 'outlet_id'),
    )


class Category(Base):
    __tablename__ = 'categories'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    name = Column(String(200), nullable=False)
    color = Column(String(20), nullable=False, default='#6b7280')
    icon = Column(String(50), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by_staff_id = Column(_BigInt, ForeignKey('staff.id'), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    products = relationship('Product', back_populates='category')
    outlet_categories = relationship('OutletCategory', back_populates='category')

    __table_args__ = (
        Index('idx_categories_uuid', 'uuid'),
        Index('idx_categories_active', 'is_active', 'sort_order'),
        Index('idx_categories_updated', 'updated_at'),
    )


class Product(Base):
    __tablename__ = 'products'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    category_id = Column(_BigInt, ForeignKey('categories.id', ondelete='SET NULL'), nullable=True)
    sku = Column(String(100), unique=True, nullable=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    barcode = Column(String(100), nullable=True)
    image_url = Column(String(500), nullable=True)
    default_price_lkr = Column(Numeric(14, 2), nullable=False, default=0)
    default_price_usd = Column(Numeric(14, 2), nullable=False, default=0)
    default_cost = Column(Numeric(14, 2), nullable=True)
    vat_rate_override = Column(Numeric(5, 2), nullable=True)
    unit = Column(String(20), nullable=False, default='pcs')
    is_taxable = Column(Boolean, nullable=False, default=True)
    track_stock = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by_staff_id = Column(_BigInt, ForeignKey('staff.id'), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    category = relationship('Category', back_populates='products')
    outlet_products = relationship('OutletProduct', back_populates='product')

    __table_args__ = (
        Index('idx_products_uuid', 'uuid'),
        Index('idx_products_category', 'category_id'),
        Index('idx_products_name', 'name'),
        Index('idx_products_barcode', 'barcode'),
        Index('idx_products_sku', 'sku'),
        Index('idx_products_active', 'is_active'),
        Index('idx_products_updated', 'updated_at'),
    )


class OutletCategory(Base):
    __tablename__ = 'outlet_categories'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    outlet_id = Column(_BigInt, ForeignKey('outlets.id', ondelete='CASCADE'), nullable=False)
    category_id = Column(_BigInt, ForeignKey('categories.id', ondelete='CASCADE'), nullable=False)
    is_visible = Column(Boolean, nullable=False, default=True)
    sort_order_override = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    outlet = relationship('Outlet', back_populates='outlet_categories')
    category = relationship('Category', back_populates='outlet_categories')

    __table_args__ = (
        UniqueConstraint('outlet_id', 'category_id'),
        Index('idx_oc_uuid', 'uuid'),
        Index('idx_oc_outlet', 'outlet_id', 'is_visible'),
    )


class OutletProduct(Base):
    __tablename__ = 'outlet_products'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    outlet_id = Column(_BigInt, ForeignKey('outlets.id', ondelete='CASCADE'), nullable=False)
    product_id = Column(_BigInt, ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    price_lkr_override = Column(Numeric(14, 2), nullable=True)
    price_usd_override = Column(Numeric(14, 2), nullable=True)
    cost_override = Column(Numeric(14, 2), nullable=True)
    stock_quantity = Column(Numeric(14, 3), nullable=False, default=0)
    reorder_threshold = Column(Numeric(14, 3), nullable=True)
    is_available = Column(Boolean, nullable=False, default=True)
    last_stock_update_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    outlet = relationship('Outlet', back_populates='outlet_products')
    product = relationship('Product', back_populates='outlet_products')
    stock_movements = relationship('StockMovement', back_populates='outlet_product')

    __table_args__ = (
        UniqueConstraint('outlet_id', 'product_id'),
        Index('idx_op_uuid', 'uuid'),
        Index('idx_op_outlet_avail', 'outlet_id', 'is_available'),
        Index('idx_op_updated', 'updated_at'),
    )


class Table(Base):
    __tablename__ = 'tables'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    outlet_id = Column(_BigInt, ForeignKey('outlets.id', ondelete='CASCADE'), nullable=False)
    assigned_terminal_id = Column(_BigInt, ForeignKey('terminals.id'), nullable=True)
    name = Column(String(100), nullable=False)
    capacity = Column(SmallInteger, nullable=False, default=4)
    section = Column(String(50), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    outlet = relationship('Outlet', back_populates='tables')

    __table_args__ = (
        UniqueConstraint('outlet_id', 'name'),
        Index('idx_tables_uuid', 'uuid'),
        Index('idx_tables_outlet', 'outlet_id', 'is_active'),
        Index('idx_tables_terminal', 'assigned_terminal_id'),
    )


class Customer(Base):
    __tablename__ = 'customers'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    phone = Column(String(30), unique=True, nullable=True)
    name = Column(String(200), nullable=True)
    email = Column(String(255), nullable=True)
    loyalty_card_no = Column(String(50), unique=True, nullable=True)
    loyalty_points = Column(Integer, nullable=False, default=0)
    total_spent = Column(Numeric(14, 2), nullable=False, default=0)
    visit_count = Column(Integer, nullable=False, default=0)
    first_visit_outlet_id = Column(_BigInt, ForeignKey('outlets.id'), nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    orders = relationship('Order', back_populates='customer')

    __table_args__ = (
        Index('idx_cust_uuid', 'uuid'),
        Index('idx_cust_phone', 'phone'),
        Index('idx_cust_loyalty', 'loyalty_card_no'),
    )


class Order(Base):
    __tablename__ = 'orders'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    outlet_id = Column(_BigInt, ForeignKey('outlets.id'), nullable=False)
    terminal_id = Column(_BigInt, ForeignKey('terminals.id'), nullable=False)
    created_by_staff_id = Column(_BigInt, ForeignKey('staff.id'), nullable=True)
    customer_id = Column(_BigInt, ForeignKey('customers.id'), nullable=True)
    table_uuid = Column(String(100), nullable=True)
    table_name = Column(String(100), nullable=True)
    terminal_order_ref = Column(String(100), nullable=False)
    tax_invoice_no = Column(String(50), unique=True, nullable=True)
    tax_invoice_issued_at = Column(DateTime(timezone=True), nullable=True)
    currency = Column(String(10), nullable=False, default='LKR')
    subtotal = Column(Numeric(14, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(14, 2), nullable=False, default=0)
    discount_reason = Column(String(200), nullable=True)
    service_charge = Column(Numeric(14, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(14, 2), nullable=False, default=0)
    total_amount = Column(Numeric(14, 2), nullable=False, default=0)
    paid_amount = Column(Numeric(14, 2), nullable=False, default=0)
    change_amount = Column(Numeric(14, 2), nullable=False, default=0)
    status = Column(String(20), nullable=False, default='completed')
    void_reason = Column(String(200), nullable=True)
    voided_by_staff_id = Column(_BigInt, ForeignKey('staff.id'), nullable=True)
    notes = Column(Text, nullable=True)
    order_created_at = Column(DateTime(timezone=True), nullable=False)
    synced_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    outlet = relationship('Outlet', back_populates='orders')
    terminal = relationship('Terminal', back_populates='orders')
    created_by_staff = relationship('Staff', back_populates='orders', foreign_keys=[created_by_staff_id])
    voided_by_staff = relationship('Staff', foreign_keys=[voided_by_staff_id])
    customer = relationship('Customer', back_populates='orders')
    items = relationship('OrderItem', back_populates='order', cascade='all, delete-orphan')
    payments = relationship('Payment', back_populates='order', cascade='all, delete-orphan')

    __table_args__ = (
        UniqueConstraint('terminal_id', 'terminal_order_ref'),
        Index('idx_orders_uuid', 'uuid'),
        Index('idx_orders_outlet_date', 'outlet_id', 'order_created_at'),
        Index('idx_orders_terminal_date', 'terminal_id', 'order_created_at'),
        Index('idx_orders_status', 'status', 'outlet_id'),
        Index('idx_orders_invoice', 'tax_invoice_no'),
        Index('idx_orders_customer', 'customer_id'),
    )


class OrderItem(Base):
    __tablename__ = 'order_items'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    order_id = Column(_BigInt, ForeignKey('orders.id', ondelete='CASCADE'), nullable=False)
    product_uuid = Column(String(100), nullable=True)
    product_id = Column(_BigInt, nullable=True)
    product_name = Column(String(200), nullable=False)
    product_sku = Column(String(100), nullable=True)
    quantity = Column(Numeric(14, 3), nullable=False, default=1)
    unit_price = Column(Numeric(14, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(14, 2), nullable=False, default=0)
    vat_rate = Column(Numeric(5, 2), nullable=False, default=0)
    vat_amount = Column(Numeric(14, 2), nullable=False, default=0)
    line_total = Column(Numeric(14, 2), nullable=False, default=0)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    order = relationship('Order', back_populates='items')

    __table_args__ = (
        Index('idx_oi_uuid', 'uuid'),
        Index('idx_oi_order', 'order_id'),
        Index('idx_oi_product', 'product_id'),
    )


class Payment(Base):
    __tablename__ = 'payments'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    order_id = Column(_BigInt, ForeignKey('orders.id', ondelete='CASCADE'), nullable=False)
    payment_method = Column(String(30), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default='LKR')
    card_last4 = Column(String(4), nullable=True)
    card_brand = Column(String(20), nullable=True)
    transaction_ref = Column(String(200), nullable=True)
    status = Column(String(20), nullable=False, default='success')
    paid_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    order = relationship('Order', back_populates='payments')

    __table_args__ = (
        Index('idx_pay_uuid', 'uuid'),
        Index('idx_pay_order', 'order_id'),
        Index('idx_pay_method_date', 'payment_method', 'paid_at'),
    )


class StockMovement(Base):
    __tablename__ = 'stock_movements'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    outlet_id = Column(_BigInt, ForeignKey('outlets.id'), nullable=False)
    outlet_product_id = Column(_BigInt, ForeignKey('outlet_products.id'), nullable=False)
    terminal_id = Column(_BigInt, ForeignKey('terminals.id'), nullable=True)
    staff_id = Column(_BigInt, ForeignKey('staff.id'), nullable=True)
    movement_type = Column(String(30), nullable=False)
    quantity_change = Column(Numeric(14, 3), nullable=False)
    stock_after = Column(Numeric(14, 3), nullable=False, default=0)
    unit_cost = Column(Numeric(14, 2), nullable=True)
    reference_type = Column(String(30), nullable=True)
    reference_uuid = Column(String(100), nullable=True)
    reason = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    outlet_product = relationship('OutletProduct', back_populates='stock_movements')

    __table_args__ = (
        Index('idx_sm_uuid', 'uuid'),
        Index('idx_sm_outlet_product_date', 'outlet_product_id', 'created_at'),
        Index('idx_sm_outlet_date', 'outlet_id', 'created_at'),
        Index('idx_sm_type', 'movement_type', 'created_at'),
        Index('idx_sm_reference', 'reference_type', 'reference_uuid'),
    )


class InvoiceCounter(Base):
    __tablename__ = 'invoice_counters'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    outlet_id = Column(_BigInt, ForeignKey('outlets.id'), nullable=False)
    year = Column(SmallInteger, nullable=False)
    counter_type = Column(String(20), nullable=False, default='invoice')
    last_value = Column(_BigInt, nullable=False, default=0)
    format_pattern = Column(String(100), nullable=False, default='{prefix}/{year}/{seq:06d}')
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('outlet_id', 'year', 'counter_type'),
    )


class AuditLog(Base):
    __tablename__ = 'audit_log'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    uuid = Column(String(100), unique=True, nullable=False, default=_uuid4)
    outlet_id = Column(_BigInt, ForeignKey('outlets.id'), nullable=True)
    terminal_id = Column(_BigInt, ForeignKey('terminals.id'), nullable=True)
    staff_id = Column(_BigInt, ForeignKey('staff.id'), nullable=True)
    action = Column(String(50), nullable=False)
    entity_type = Column(String(50), nullable=True)
    entity_uuid = Column(String(100), nullable=True)
    details = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False)
    synced_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    terminal = relationship('Terminal', back_populates='audit_logs')
    staff = relationship('Staff', back_populates='audit_logs')

    __table_args__ = (
        Index('idx_audit_uuid', 'uuid'),
        Index('idx_audit_outlet_date', 'outlet_id', 'occurred_at'),
        Index('idx_audit_staff_date', 'staff_id', 'occurred_at'),
        Index('idx_audit_action', 'action', 'occurred_at'),
        Index('idx_audit_entity', 'entity_type', 'entity_uuid'),
    )


class SyncLog(Base):
    __tablename__ = 'sync_logs'

    id = Column(_BigInt, primary_key=True, autoincrement=True)
    outlet_id = Column(_BigInt, ForeignKey('outlets.id'), nullable=True)
    terminal_id = Column(_BigInt, ForeignKey('terminals.id'), nullable=True)
    terminal_code = Column(String(100), nullable=False, default='')
    sync_type = Column(String(20), nullable=False)
    direction = Column(String(10), nullable=False)
    records_affected = Column(Integer, nullable=False, default=0)
    duration_ms = Column(Integer, nullable=True)
    status = Column(String(20), nullable=False, default='success')
    error_message = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    synced_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    outlet = relationship('Outlet')
    terminal = relationship('Terminal', back_populates='sync_logs')

    __table_args__ = (
        Index('idx_sl_terminal_date', 'terminal_id', 'synced_at'),
        Index('idx_sl_outlet_date', 'outlet_id', 'synced_at'),
        Index('idx_sl_status', 'status', 'synced_at'),
    )
