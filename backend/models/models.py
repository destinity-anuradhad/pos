from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Terminal(Base):
    __tablename__ = "terminals"
    id              = Column(Integer, primary_key=True, index=True)
    uuid            = Column(String(100), unique=True, nullable=False)
    terminal_code   = Column(String(100), unique=True, nullable=False)   # user-typed e.g. COL-M-01
    terminal_name   = Column(String(200), nullable=False)
    platform        = Column(String(50), nullable=False)                 # web/windows/android/ios/macos
    is_active       = Column(Boolean, default=True, nullable=False)
    registered_at   = Column(DateTime(timezone=True), server_default=func.now())
    last_seen_at    = Column(DateTime(timezone=True), nullable=True)
    registered_by   = Column(String(200), nullable=True)
    orders          = relationship("Order", back_populates="terminal")
    sync_logs       = relationship("SyncLog", back_populates="terminal")


class SyncLog(Base):
    __tablename__ = "sync_log"
    id               = Column(Integer, primary_key=True, index=True)
    terminal_id      = Column(Integer, ForeignKey("terminals.id"), nullable=True)
    sync_type        = Column(String(50), nullable=False)   # master / transactions
    direction        = Column(String(20), nullable=False)   # pull / push
    status           = Column(String(20), nullable=False)   # success / failed
    records_affected = Column(Integer, default=0)
    error_message    = Column(Text, nullable=True)
    synced_at        = Column(DateTime(timezone=True), server_default=func.now())
    terminal         = relationship("Terminal", back_populates="sync_logs")


class SyncSettings(Base):
    __tablename__ = "sync_settings"
    id                          = Column(Integer, primary_key=True, index=True)
    sync_interval_minutes       = Column(Integer, default=10)
    auto_sync_enabled           = Column(Boolean, default=True)
    last_master_sync_at         = Column(DateTime(timezone=True), nullable=True)
    last_transaction_sync_at    = Column(DateTime(timezone=True), nullable=True)
    updated_at                  = Column(DateTime(timezone=True), onupdate=func.now())


class TableStatus(Base):
    __tablename__ = "table_statuses"
    id          = Column(Integer, primary_key=True, index=True)
    code        = Column(String(50), unique=True, nullable=False)   # available, seated, ordered, billed, cleaning, reserved
    label       = Column(String(100), nullable=False)
    color       = Column(String(20), default="#64748b")
    sort_order  = Column(Integer, default=0)
    is_system   = Column(Boolean, default=False, nullable=False)    # system states cannot be deleted
    is_active   = Column(Boolean, default=True, nullable=False)
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())
    synced_at   = Column(DateTime(timezone=True), nullable=True)
    tables      = relationship("RestaurantTable", back_populates="table_status")
    transitions_from = relationship("TableStatusTransition", foreign_keys="TableStatusTransition.from_status_id", back_populates="from_status")
    transitions_to   = relationship("TableStatusTransition", foreign_keys="TableStatusTransition.to_status_id",   back_populates="to_status")


class TableStatusTransition(Base):
    __tablename__ = "table_status_transitions"
    id              = Column(Integer, primary_key=True, index=True)
    from_status_id  = Column(Integer, ForeignKey("table_statuses.id"), nullable=False)
    to_status_id    = Column(Integer, ForeignKey("table_statuses.id"), nullable=False)
    trigger_type    = Column(String(20), nullable=False)    # manual / auto
    trigger_event   = Column(String(100), nullable=True)    # first_item_added / checkout_clicked / payment_confirmed / staff_action
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())
    synced_at       = Column(DateTime(timezone=True), nullable=True)
    from_status     = relationship("TableStatus", foreign_keys=[from_status_id], back_populates="transitions_from")
    to_status       = relationship("TableStatus", foreign_keys=[to_status_id],   back_populates="transitions_to")


class Category(Base):
    __tablename__ = "categories"
    id                   = Column(Integer, primary_key=True, index=True)
    name                 = Column(String(200), nullable=False)
    color                = Column(String(20), default="#094f70")
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), onupdate=func.now())
    synced_at            = Column(DateTime(timezone=True), nullable=True)
    sync_status          = Column(String(20), default="pending")    # pending / synced
    modified_by_terminal = Column(String(100), nullable=True)       # terminal_code that last modified
    products             = relationship("Product", back_populates="category")


class Product(Base):
    __tablename__ = "products"
    id                   = Column(Integer, primary_key=True, index=True)
    name                 = Column(String(200), nullable=False, index=True)
    category_id          = Column(Integer, ForeignKey("categories.id"), nullable=True)
    price_lkr            = Column(Float, nullable=False, default=0)
    price_usd            = Column(Float, nullable=False, default=0)
    barcode              = Column(String(100), nullable=True, index=True)
    image_url            = Column(String(500), nullable=True)
    stock_quantity       = Column(Integer, default=-1, nullable=False)  # -1 = unlimited, 0+ = tracked
    is_active            = Column(Boolean, default=True, nullable=False)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), onupdate=func.now())
    synced_at            = Column(DateTime(timezone=True), nullable=True)
    sync_status          = Column(String(20), default="pending")    # pending / synced
    modified_by_terminal = Column(String(100), nullable=True)       # terminal_code that last modified
    category             = relationship("Category", back_populates="products")


class RestaurantTable(Base):
    __tablename__ = "tables"
    id                   = Column(Integer, primary_key=True, index=True)
    name                 = Column(String(100), nullable=False)
    capacity             = Column(Integer, default=4, nullable=False)
    status_id            = Column(Integer, ForeignKey("table_statuses.id"), nullable=True)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), onupdate=func.now())
    synced_at            = Column(DateTime(timezone=True), nullable=True)
    sync_status          = Column(String(20), default="pending")    # pending / synced
    modified_by_terminal = Column(String(100), nullable=True)       # terminal_code that last modified
    table_status         = relationship("TableStatus", back_populates="tables")
    orders               = relationship("Order", back_populates="table")


class Order(Base):
    __tablename__ = "orders"
    id                  = Column(Integer, primary_key=True, index=True)
    terminal_id         = Column(Integer, ForeignKey("terminals.id"), nullable=True)
    terminal_order_ref  = Column(String(200), unique=True, nullable=True, index=True)  # e.g. COL-M-01-0045
    hq_order_id         = Column(Integer, nullable=True, index=True)                    # assigned by cloud on sync
    table_id            = Column(Integer, ForeignKey("tables.id"), nullable=True)
    currency            = Column(String(10), default="LKR", nullable=False)
    total_amount        = Column(Float, default=0, nullable=False)
    status              = Column(String(20), default="pending", nullable=False, index=True)   # pending, completed, cancelled
    payment_method      = Column(String(50), nullable=True)                                    # cash, card
    sync_status         = Column(String(20), default="pending", nullable=False)               # pending, syncing, synced, failed
    receipt_sent        = Column(Boolean, default=False, nullable=False)
    created_at          = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    synced_at           = Column(DateTime(timezone=True), nullable=True)
    terminal            = relationship("Terminal", back_populates="orders")
    table               = relationship("RestaurantTable", back_populates="orders")
    items               = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"
    id           = Column(Integer, primary_key=True, index=True)
    order_id     = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id   = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String(200), nullable=True)    # snapshot at time of order
    quantity     = Column(Integer, default=1, nullable=False)
    unit_price   = Column(Float, default=0, nullable=False)
    subtotal     = Column(Float, default=0, nullable=False)
    order        = relationship("Order", back_populates="items")
    product      = relationship("Product")


class Setting(Base):
    __tablename__ = "settings"
    id          = Column(Integer, primary_key=True, index=True)
    key         = Column(String(200), unique=True, nullable=False)
    value       = Column(Text, nullable=True)
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())
    synced_at   = Column(DateTime(timezone=True), nullable=True)
