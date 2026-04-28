from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    ForeignKey, Text, UniqueConstraint
)
from sqlalchemy.orm import relationship
from database import Base


def _now():
    return datetime.now(timezone.utc)


class Outlet(Base):
    __tablename__ = 'outlets'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    code = Column(String(50), unique=True, nullable=False)   # e.g. "COL-01"
    address = Column(Text, default='')
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=_now, nullable=False)

    terminals = relationship('Terminal', back_populates='outlet')
    orders = relationship('Order', back_populates='outlet')


class Terminal(Base):
    __tablename__ = 'terminals'

    id = Column(Integer, primary_key=True, index=True)
    outlet_id = Column(Integer, ForeignKey('outlets.id'), nullable=True)
    terminal_code = Column(String(100), unique=True, nullable=False)
    terminal_name = Column(String(200), default='')
    uuid = Column(String(100), unique=True, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=_now, nullable=False)

    outlet = relationship('Outlet', back_populates='terminals')
    orders = relationship('Order', back_populates='terminal')
    sync_logs = relationship('SyncLog', back_populates='terminal')


class Category(Base):
    __tablename__ = 'categories'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    color = Column(String(20), default='#6b7280')
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=_now, nullable=False)
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)

    products = relationship('Product', back_populates='category')


class Product(Base):
    __tablename__ = 'products'

    id = Column(Integer, primary_key=True, index=True)
    category_id = Column(Integer, ForeignKey('categories.id'), nullable=True)
    name = Column(String(200), nullable=False)
    price_lkr = Column(Float, default=0.0, nullable=False)
    price_usd = Column(Float, default=0.0, nullable=False)
    barcode = Column(String(100), nullable=True)
    stock_quantity = Column(Integer, default=-1, nullable=False)  # -1 = unlimited
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=_now, nullable=False)
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)

    category = relationship('Category', back_populates='products')


class RestaurantTable(Base):
    __tablename__ = 'tables'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    capacity = Column(Integer, default=4, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=_now, nullable=False)
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)


class Order(Base):
    __tablename__ = 'orders'

    id = Column(Integer, primary_key=True, index=True)
    terminal_id = Column(Integer, ForeignKey('terminals.id'), nullable=True)
    outlet_id = Column(Integer, ForeignKey('outlets.id'), nullable=True)
    # Unique ref from the originating terminal — prevents duplicate syncs
    terminal_order_ref = Column(String(200), unique=True, nullable=True, index=True)
    table_name = Column(String(100), default='')
    currency = Column(String(10), default='LKR')
    total_amount = Column(Float, default=0.0, nullable=False)
    status = Column(String(50), default='completed')        # pending/completed/cancelled
    payment_method = Column(String(50), default='cash')
    synced_at = Column(DateTime, default=_now, nullable=False)
    order_created_at = Column(DateTime, nullable=True)      # original timestamp from terminal

    terminal = relationship('Terminal', back_populates='orders')
    outlet = relationship('Outlet', back_populates='orders')
    items = relationship('OrderItem', back_populates='order', cascade='all, delete-orphan')


class OrderItem(Base):
    __tablename__ = 'order_items'

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey('orders.id'), nullable=False)
    product_id = Column(Integer, nullable=True)              # snapshot — product may be deleted later
    product_name = Column(String(200), nullable=False)       # denormalised snapshot
    quantity = Column(Integer, default=1, nullable=False)
    unit_price = Column(Float, default=0.0, nullable=False)
    subtotal = Column(Float, default=0.0, nullable=False)

    order = relationship('Order', back_populates='items')
    # No FK relationship to Product — product_id is a snapshot; the product may be deleted later


class SyncLog(Base):
    __tablename__ = 'sync_logs'

    id = Column(Integer, primary_key=True, index=True)
    terminal_id = Column(Integer, ForeignKey('terminals.id'), nullable=True)
    terminal_code = Column(String(100), default='')
    sync_type = Column(String(20), default='orders')        # 'orders' | 'master'
    direction = Column(String(10), default='push')          # 'push' | 'pull'
    records_affected = Column(Integer, default=0)
    status = Column(String(20), default='success')          # 'success' | 'partial' | 'failed'
    error_message = Column(Text, nullable=True)
    synced_at = Column(DateTime, default=_now, nullable=False)

    terminal = relationship('Terminal', back_populates='sync_logs')
