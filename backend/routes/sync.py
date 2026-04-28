from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import (
    Product, Category, Order, OrderItem, RestaurantTable,
    TableStatus, Setting, SyncLog, Terminal
)
from datetime import datetime

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
                errors.append({'terminal_order_ref': od.get('terminal_order_ref'), 'error': str(e)})

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
