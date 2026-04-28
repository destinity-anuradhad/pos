from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from database import get_db
from models.models import (
    Order, OrderItem, Category, Product, Terminal, SyncLog
)

sync_bp = Blueprint('sync', __name__)


def _parse_dt(value):
    """Parse an ISO datetime string, returning None on failure."""
    if not value:
        return None
    try:
        # Handle both Z-suffix and +00:00 offset formats
        if isinstance(value, str):
            value = value.replace('Z', '+00:00')
            return datetime.fromisoformat(value)
        return value
    except (ValueError, AttributeError):
        return None


def _order_to_dict(order):
    return {
        'hq_order_id': order.id,
        'terminal_order_ref': order.terminal_order_ref,
        'terminal_id': order.terminal_id,
        'outlet_id': order.outlet_id,
        'table_name': order.table_name,
        'currency': order.currency,
        'total_amount': order.total_amount,
        'status': order.status,
        'payment_method': order.payment_method,
        'synced_at': order.synced_at.isoformat() if order.synced_at else None,
        'order_created_at': order.order_created_at.isoformat() if order.order_created_at else None,
        'items': [_item_to_dict(i) for i in order.items],
    }


def _item_to_dict(item):
    return {
        'id': item.id,
        'product_id': item.product_id,
        'product_name': item.product_name,
        'quantity': item.quantity,
        'unit_price': item.unit_price,
        'subtotal': item.subtotal,
    }


@sync_bp.post('/push')
def push_orders():
    """
    Terminals push pending orders here.

    Payload:
    {
      "terminal_code": "T-001",       // optional — used for logging if terminal_id absent
      "terminal_id": 1,               // optional
      "orders": [
        {
          "terminal_order_ref": "T001-1680000000",
          "table_name": "Table 3",    // or table_id (ignored, we just store the name)
          "table_id": 5,              // accepted but ignored — we prefer table_name
          "currency": "LKR",
          "total_amount": 1200.0,
          "status": "completed",
          "payment_method": "cash",
          "order_created_at": "2024-01-01T12:00:00Z",
          "items": [
            {
              "product_id": 2,
              "product_name": "Kottu",
              "quantity": 2,
              "unit_price": 550,
              "subtotal": 1100
            }
          ]
        }
      ]
    }

    Returns:
    {
      "synced": 3,
      "errors": 0,
      "already_synced": 1,
      "results": [{ "terminal_order_ref": "...", "hq_order_id": 7, "status": "synced" }]
    }
    """
    data = request.get_json(silent=True) or {}
    orders_payload = data.get('orders', [])
    terminal_id = data.get('terminal_id')
    terminal_code = data.get('terminal_code', '')

    db = get_db()
    synced_count = 0
    error_count = 0
    already_synced_count = 0
    results = []

    # Resolve terminal record for FK and sync logging
    terminal_record = None
    outlet_id = None
    if terminal_id:
        try:
            terminal_record = db.query(Terminal).filter(Terminal.id == terminal_id).first()
        except Exception:
            pass
    if not terminal_record and terminal_code:
        try:
            terminal_record = db.query(Terminal).filter(
                Terminal.terminal_code == terminal_code
            ).first()
        except Exception:
            pass

    if terminal_record:
        terminal_id = terminal_record.id
        outlet_id = terminal_record.outlet_id
        terminal_code = terminal_record.terminal_code or terminal_code

    try:
        for order_data in orders_payload:
            ref = order_data.get('terminal_order_ref')
            if not ref:
                error_count += 1
                results.append({
                    'terminal_order_ref': None,
                    'hq_order_id': None,
                    'status': 'error',
                    'error': 'terminal_order_ref is required',
                })
                continue

            # Duplicate protection
            existing = db.query(Order).filter(Order.terminal_order_ref == ref).first()
            if existing:
                already_synced_count += 1
                results.append({
                    'terminal_order_ref': ref,
                    'hq_order_id': existing.id,
                    'status': 'already_synced',
                })
                continue

            try:
                # Accept either table_name or table_id (table_id is local, we only store the name)
                table_name = order_data.get('table_name') or ''
                if not table_name and order_data.get('table_id'):
                    table_name = f"Table {order_data['table_id']}"

                new_order = Order(
                    # Only set terminal_id if it resolves to a known cloud terminal;
                    # local terminal IDs are not valid FKs in the cloud DB.
                    terminal_id=terminal_id if terminal_record else None,
                    outlet_id=outlet_id,
                    terminal_order_ref=ref,
                    table_name=table_name,
                    currency=order_data.get('currency', 'LKR'),
                    total_amount=float(order_data.get('total_amount', 0)),
                    status=order_data.get('status', 'completed'),
                    payment_method=order_data.get('payment_method', 'cash'),
                    order_created_at=_parse_dt(order_data.get('order_created_at')),
                    synced_at=datetime.now(timezone.utc),
                )
                db.add(new_order)
                db.flush()  # get new_order.id before adding items

                for item_data in order_data.get('items', []):
                    item = OrderItem(
                        order_id=new_order.id,
                        product_id=item_data.get('product_id'),
                        product_name=item_data.get('product_name', 'Unknown'),
                        quantity=int(item_data.get('quantity', 1)),
                        unit_price=float(item_data.get('unit_price', 0)),
                        subtotal=float(item_data.get('subtotal', 0)),
                    )
                    db.add(item)

                db.commit()
                synced_count += 1
                results.append({
                    'terminal_order_ref': ref,
                    'hq_order_id': new_order.id,
                    'status': 'synced',
                })

            except Exception as e:
                db.rollback()
                error_count += 1
                results.append({
                    'terminal_order_ref': ref,
                    'hq_order_id': None,
                    'status': 'error',
                    'error': str(e),
                })

        # Update terminal last_sync_at
        if terminal_record and synced_count > 0:
            try:
                terminal_record.last_sync_at = datetime.now(timezone.utc)
                db.commit()
            except Exception:
                db.rollback()

        # Write sync log
        _write_sync_log(
            db,
            terminal_id=terminal_id,
            terminal_code=terminal_code,
            sync_type='orders',
            direction='push',
            records_affected=synced_count,
            status='success' if error_count == 0 else ('partial' if synced_count > 0 else 'failed'),
            error_message=None,
        )

    finally:
        db.close()

    return jsonify({
        'synced': synced_count,
        'errors': error_count,
        'already_synced': already_synced_count,
        'results': results,
    }), 200


@sync_bp.get('/pull')
def pull_master_data():
    """
    Terminals pull master data (categories + products).

    Optional query param:
      ?since=2024-01-01T00:00:00Z   — only return records updated after this timestamp

    Returns:
    {
      "categories": [...],
      "products": [...],
      "settings": {},
      "timestamp": "2024-01-01T12:00:00Z"
    }
    """
    since_raw = request.args.get('since')
    since_dt = _parse_dt(since_raw) if since_raw else None

    db = get_db()
    try:
        cat_query = db.query(Category).filter(Category.is_active == True)  # noqa: E712
        prod_query = db.query(Product).filter(Product.is_active == True)   # noqa: E712

        if since_dt:
            cat_query = cat_query.filter(Category.updated_at > since_dt)
            prod_query = prod_query.filter(Product.updated_at > since_dt)

        categories = cat_query.all()
        products = prod_query.all()

        categories_data = [_category_to_dict(c) for c in categories]
        products_data = [_product_to_dict(p) for p in products]

        return jsonify({
            'categories': categories_data,
            'products': products_data,
            'settings': {},
            'timestamp': datetime.now(timezone.utc).isoformat(),
        }), 200
    finally:
        db.close()


# ── Serializers ────────────────────────────────────────────────────────────────

def _category_to_dict(cat):
    return {
        'id': cat.id,
        'name': cat.name,
        'color': cat.color,
        'is_active': cat.is_active,
        'created_at': cat.created_at.isoformat() if cat.created_at else None,
        'updated_at': cat.updated_at.isoformat() if cat.updated_at else None,
    }


def _product_to_dict(prod):
    return {
        'id': prod.id,
        'category_id': prod.category_id,
        'name': prod.name,
        'price_lkr': prod.price_lkr,
        'price_usd': prod.price_usd,
        'barcode': prod.barcode,
        'stock_quantity': prod.stock_quantity,
        'is_active': prod.is_active,
        'created_at': prod.created_at.isoformat() if prod.created_at else None,
        'updated_at': prod.updated_at.isoformat() if prod.updated_at else None,
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _write_sync_log(db, terminal_id, terminal_code, sync_type, direction,
                    records_affected, status, error_message):
    try:
        log = SyncLog(
            terminal_id=terminal_id,
            terminal_code=terminal_code or '',
            sync_type=sync_type,
            direction=direction,
            records_affected=records_affected,
            status=status,
            error_message=error_message,
        )
        db.add(log)
        db.commit()
    except Exception:
        db.rollback()
