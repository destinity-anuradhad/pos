from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import (
    Product, Category, Order, OrderItem, RestaurantTable,
    TableStatus, Setting, SyncLog, Terminal
)
from datetime import datetime, timezone

sync_bp = Blueprint('sync', __name__)


# ── Pull master data (cloud → terminal) ──────────────────────────────────────

@sync_bp.get('/pull')
def pull_data():
    """Return all master data for terminal to cache locally."""
    db = db_session()
    try:
        categories = [
            {'id': c.id, 'name': c.name, 'color': c.color,
             'updated_at': c.updated_at.isoformat() if c.updated_at else None}
            for c in db.query(Category).all()
        ]

        products = [
            {'id': p.id, 'name': p.name, 'category_id': p.category_id,
             'category': p.category.name if p.category else '',
             'price_lkr': p.price_lkr, 'price_usd': p.price_usd,
             'barcode': p.barcode or '', 'stock_quantity': p.stock_quantity,
             'is_active': p.is_active,
             'updated_at': p.updated_at.isoformat() if p.updated_at else None}
            for p in db.query(Product).filter(Product.is_active == True).all()
        ]

        tables = [
            {'id': t.id, 'name': t.name, 'capacity': t.capacity,
             'status_id': t.status_id,
             'status':       t.table_status.code  if t.table_status else 'available',
             'status_label': t.table_status.label if t.table_status else 'Available',
             'status_color': t.table_status.color if t.table_status else '#22c55e',
             'updated_at': t.updated_at.isoformat() if t.updated_at else None}
            for t in db.query(RestaurantTable).all()
        ]

        table_statuses = [
            {'id': s.id, 'code': s.code, 'label': s.label, 'color': s.color,
             'sort_order': s.sort_order, 'is_system': s.is_system, 'is_active': s.is_active}
            for s in db.query(TableStatus).filter(TableStatus.is_active == True).order_by(TableStatus.sort_order).all()
        ]

        settings = {s.key: s.value for s in db.query(Setting).all()}

        return jsonify({
            'categories':    categories,
            'products':      products,
            'tables':        tables,
            'table_statuses': table_statuses,
            'settings':      settings,
            'timestamp':     datetime.utcnow().isoformat(),
        })
    finally:
        db.close()


# ── Push transactions (terminal → cloud) ─────────────────────────────────────

@sync_bp.post('/push')
def push_orders():
    """
    Accept offline orders from a terminal.
    Assigns hq_order_id for each and returns the mapping.
    Payload: { terminal_id: int, orders: [...] }
    """
    db = db_session()
    try:
        payload     = request.get_json()
        terminal_id = payload.get('terminal_id')
        results     = []
        errors      = []

        for od in payload.get('orders', []):
            try:
                # Skip if already synced (duplicate push)
                if od.get('terminal_order_ref'):
                    existing = db.query(Order).filter(
                        Order.terminal_order_ref == od['terminal_order_ref']
                    ).first()
                    if existing:
                        results.append({
                            'terminal_order_ref': od['terminal_order_ref'],
                            'hq_order_id':        existing.id,
                            'status':             'already_synced',
                        })
                        continue

                o = Order(
                    terminal_id        = terminal_id,
                    terminal_order_ref = od.get('terminal_order_ref'),
                    table_id           = od.get('table_id'),
                    currency           = od.get('currency', 'LKR'),
                    total_amount       = od.get('total_amount', 0),
                    status             = od.get('status', 'completed'),
                    payment_method     = od.get('payment_method'),
                    sync_status        = 'synced',
                    synced_at          = datetime.utcnow(),
                )
                db.add(o)
                db.flush()

                for item in od.get('items', []):
                    product = db.query(Product).filter(Product.id == item.get('product_id')).first()
                    db.add(OrderItem(
                        order_id     = o.id,
                        product_id   = item.get('product_id'),
                        product_name = item.get('product_name') or (product.name if product else ''),
                        quantity     = item['quantity'],
                        unit_price   = item['unit_price'],
                        subtotal     = item['subtotal'],
                    ))
                    # Decrement cloud stock
                    if product and product.stock_quantity >= 0:
                        product.stock_quantity = max(0, product.stock_quantity - item['quantity'])

                db.flush()
                results.append({
                    'terminal_order_ref': od.get('terminal_order_ref'),
                    'hq_order_id':        o.id,
                    'status':             'synced',
                })
            except Exception as e:
                errors.append({'terminal_order_ref': od.get('terminal_order_ref'), 'error': 'sync_error'})

        db.commit()

        # Log the sync event
        db.add(SyncLog(
            terminal_id      = terminal_id,
            sync_type        = 'transactions',
            direction        = 'push',
            status           = 'success' if not errors else 'partial',
            records_affected = len(results),
            error_message    = str(errors) if errors else None,
        ))
        db.commit()

        return jsonify({
            'synced':    len(results),
            'errors':    len(errors),
            'results':   results,
            'timestamp': datetime.utcnow().isoformat(),
        })
    finally:
        db.close()


# ── Pending master data (local → cloud) ──────────────────────────────────────

@sync_bp.get('/pending-master')
def get_pending_master():
    """Return all local master records not yet synced to cloud."""
    db = db_session()
    try:
        categories = [
            {'id': c.id, 'name': c.name, 'color': c.color,
             'sync_status': c.sync_status, 'modified_by_terminal': c.modified_by_terminal,
             'updated_at': c.updated_at.isoformat() if c.updated_at else None}
            for c in db.query(Category).filter(Category.sync_status == 'pending').all()
        ]
        products = [
            {'id': p.id, 'name': p.name, 'category_id': p.category_id,
             'category': p.category.name if p.category else '',
             'price_lkr': p.price_lkr, 'price_usd': p.price_usd,
             'barcode': p.barcode or '', 'stock_quantity': p.stock_quantity,
             'is_active': p.is_active,
             'sync_status': p.sync_status, 'modified_by_terminal': p.modified_by_terminal,
             'updated_at': p.updated_at.isoformat() if p.updated_at else None}
            for p in db.query(Product).filter(Product.sync_status == 'pending').all()
        ]
        tables = [
            {'id': t.id, 'name': t.name, 'capacity': t.capacity,
             'status': t.table_status.code if t.table_status else 'available',
             'sync_status': t.sync_status, 'modified_by_terminal': t.modified_by_terminal,
             'updated_at': t.updated_at.isoformat() if t.updated_at else None}
            for t in db.query(RestaurantTable).filter(RestaurantTable.sync_status == 'pending').all()
        ]
        return jsonify({'categories': categories, 'products': products, 'tables': tables})
    finally:
        db.close()


@sync_bp.post('/mark-master-synced')
def mark_master_synced():
    """Mark local master records as synced after cloud push succeeds."""
    data = request.get_json() or {}
    category_ids = data.get('category_ids', [])
    product_ids  = data.get('product_ids', [])
    table_ids    = data.get('table_ids', [])
    now = datetime.now(timezone.utc)

    db = db_session()
    try:
        for cid in category_ids:
            c = db.query(Category).filter(Category.id == cid).first()
            if c:
                c.sync_status = 'synced'
                c.synced_at   = now
        for pid in product_ids:
            p = db.query(Product).filter(Product.id == pid).first()
            if p:
                p.sync_status = 'synced'
                p.synced_at   = now
        for tid in table_ids:
            t = db.query(RestaurantTable).filter(RestaurantTable.id == tid).first()
            if t:
                t.sync_status = 'synced'
                t.synced_at   = now
        db.commit()
        return jsonify({'ok': True,
                        'categories': len(category_ids),
                        'products':   len(product_ids),
                        'tables':     len(table_ids)})
    finally:
        db.close()


@sync_bp.post('/apply-master')
def apply_master():
    """
    Apply master data pulled from cloud into the local DB.
    This is a bulk upsert — cloud is authoritative for these fields.
    Payload: { categories: [...], products: [...], tables: [...] }
    """
    data = request.get_json() or {}
    db = db_session()
    try:
        now = datetime.now(timezone.utc)
        counts = {'categories': 0, 'products': 0, 'tables': 0}

        for c in data.get('categories', []):
            existing = db.query(Category).filter(Category.id == c['id']).first()
            if existing:
                existing.name        = c.get('name', existing.name)
                existing.color       = c.get('color', existing.color)
                existing.sync_status = 'synced'
                existing.synced_at   = now
            else:
                db.add(Category(
                    id          = c['id'],
                    name        = c['name'],
                    color       = c.get('color', '#094f70'),
                    sync_status = 'synced',
                    synced_at   = now,
                ))
            counts['categories'] += 1

        for p in data.get('products', []):
            existing = db.query(Product).filter(Product.id == p['id']).first()
            if existing:
                existing.name           = p.get('name', existing.name)
                existing.price_lkr      = p.get('price_lkr', existing.price_lkr)
                existing.price_usd      = p.get('price_usd', existing.price_usd)
                existing.stock_quantity = p.get('stock_quantity', existing.stock_quantity)
                existing.is_active      = p.get('is_active', existing.is_active)
                existing.barcode        = p.get('barcode') or existing.barcode
                existing.sync_status    = 'synced'
                existing.synced_at      = now
            else:
                db.add(Product(
                    id             = p['id'],
                    name           = p['name'],
                    category_id    = p.get('category_id'),
                    price_lkr      = p.get('price_lkr', 0),
                    price_usd      = p.get('price_usd', 0),
                    barcode        = p.get('barcode') or None,
                    stock_quantity = p.get('stock_quantity', -1),
                    is_active      = p.get('is_active', True),
                    sync_status    = 'synced',
                    synced_at      = now,
                ))
            counts['products'] += 1

        for t in data.get('tables', []):
            existing = db.query(RestaurantTable).filter(RestaurantTable.id == t['id']).first()
            # Resolve status_id from code if needed
            status_id = None
            if t.get('status'):
                s = db.query(TableStatus).filter(TableStatus.code == t['status']).first()
                if s:
                    status_id = s.id
            if existing:
                existing.name        = t.get('name', existing.name)
                existing.capacity    = t.get('capacity', existing.capacity)
                if status_id:
                    existing.status_id = status_id
                existing.sync_status = 'synced'
                existing.synced_at   = now
            else:
                db.add(RestaurantTable(
                    id          = t['id'],
                    name        = t['name'],
                    capacity    = t.get('capacity', 4),
                    status_id   = status_id,
                    sync_status = 'synced',
                    synced_at   = now,
                ))
            counts['tables'] += 1

        db.commit()
        return jsonify({'ok': True, **counts})
    finally:
        db.close()


# ── Sync log ──────────────────────────────────────────────────────────────────

@sync_bp.get('/log')
def get_sync_log():
    """Return recent sync log entries."""
    db = db_session()
    try:
        terminal_id = request.args.get('terminal_id')
        limit       = int(request.args.get('limit', 50))
        q = db.query(SyncLog).order_by(SyncLog.synced_at.desc())
        if terminal_id:
            q = q.filter(SyncLog.terminal_id == int(terminal_id))
        entries = q.limit(limit).all()
        return jsonify([
            {
                'id':               e.id,
                'terminal_id':      e.terminal_id,
                'terminal_code':    e.terminal.terminal_code if e.terminal else None,
                'sync_type':        e.sync_type,
                'direction':        e.direction,
                'status':           e.status,
                'records_affected': e.records_affected,
                'error_message':    e.error_message,
                'synced_at':        e.synced_at.isoformat() if e.synced_at else None,
            }
            for e in entries
        ])
    finally:
        db.close()
