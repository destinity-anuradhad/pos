from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from sqlalchemy import func
from database import get_db
from models.models import Order, OrderItem, Terminal, Outlet

reports_bp = Blueprint('reports', __name__)

# Statuses excluded from revenue totals
_EXCLUDED_STATUSES = ('cancelled',)


def _parse_dt(value):
    if not value:
        return None
    try:
        if isinstance(value, str):
            value = value.replace('Z', '+00:00')
            return datetime.fromisoformat(value)
        return value
    except (ValueError, AttributeError):
        return None


def _apply_common_filters(q, from_dt, to_dt, outlet_id, terminal_id):
    """Apply date range, outlet, and terminal filters to an Order query."""
    q = q.filter(~Order.status.in_(_EXCLUDED_STATUSES))
    if from_dt:
        q = q.filter(Order.synced_at >= from_dt)
    if to_dt:
        q = q.filter(Order.synced_at <= to_dt)
    if outlet_id:
        q = q.filter(Order.outlet_id == outlet_id)
    if terminal_id:
        q = q.filter(Order.terminal_id == terminal_id)
    return q


@reports_bp.get('/sales')
def sales_summary():
    """
    Overall sales totals.

    Query params: from, to, outlet_id, terminal_id
    Returns: { total_lkr, total_usd, order_count, avg_order_lkr }
    """
    from_dt = _parse_dt(request.args.get('from'))
    to_dt = _parse_dt(request.args.get('to'))
    outlet_id = request.args.get('outlet_id', type=int)
    terminal_id = request.args.get('terminal_id', type=int)

    db = get_db()
    try:
        q = db.query(Order)
        q = _apply_common_filters(q, from_dt, to_dt, outlet_id, terminal_id)
        orders = q.all()

        total_lkr = sum(o.total_amount for o in orders if o.currency == 'LKR')
        total_usd = sum(o.total_amount for o in orders if o.currency == 'USD')
        order_count = len(orders)
        avg_order_lkr = (total_lkr / order_count) if order_count > 0 else 0.0

        return jsonify({
            'total_lkr': round(total_lkr, 2),
            'total_usd': round(total_usd, 2),
            'order_count': order_count,
            'avg_order_lkr': round(avg_order_lkr, 2),
        }), 200
    finally:
        db.close()


@reports_bp.get('/outlets')
def sales_by_outlet():
    """Sales breakdown per outlet. Supports same filters as /sales (except outlet_id)."""
    from_dt = _parse_dt(request.args.get('from'))
    to_dt = _parse_dt(request.args.get('to'))
    terminal_id = request.args.get('terminal_id', type=int)

    db = get_db()
    try:
        q = db.query(Order)
        q = _apply_common_filters(q, from_dt, to_dt, outlet_id=None, terminal_id=terminal_id)
        orders = q.all()

        # Group in Python to avoid dialect differences (SQLite vs PostgreSQL)
        outlet_map: dict = {}
        for o in orders:
            key = o.outlet_id
            if key not in outlet_map:
                outlet = db.query(Outlet).filter(Outlet.id == key).first() if key else None
                outlet_map[key] = {
                    'outlet_id': key,
                    'outlet_name': outlet.name if outlet else 'Unknown',
                    'outlet_code': outlet.code if outlet else None,
                    'total_lkr': 0.0,
                    'total_usd': 0.0,
                    'order_count': 0,
                }
            row = outlet_map[key]
            row['order_count'] += 1
            if o.currency == 'LKR':
                row['total_lkr'] += o.total_amount
            else:
                row['total_usd'] += o.total_amount

        result = []
        for row in outlet_map.values():
            row['total_lkr'] = round(row['total_lkr'], 2)
            row['total_usd'] = round(row['total_usd'], 2)
            result.append(row)

        result.sort(key=lambda x: x['total_lkr'], reverse=True)
        return jsonify(result), 200
    finally:
        db.close()


@reports_bp.get('/terminals')
def sales_by_terminal():
    """Sales breakdown per terminal."""
    from_dt = _parse_dt(request.args.get('from'))
    to_dt = _parse_dt(request.args.get('to'))
    outlet_id = request.args.get('outlet_id', type=int)

    db = get_db()
    try:
        q = db.query(Order)
        q = _apply_common_filters(q, from_dt, to_dt, outlet_id=outlet_id, terminal_id=None)
        orders = q.all()

        terminal_map: dict = {}
        for o in orders:
            key = o.terminal_id
            if key not in terminal_map:
                terminal = db.query(Terminal).filter(Terminal.id == key).first() if key else None
                terminal_map[key] = {
                    'terminal_id': key,
                    'terminal_code': terminal.terminal_code if terminal else 'Unknown',
                    'terminal_name': terminal.terminal_name if terminal else '',
                    'outlet_id': terminal.outlet_id if terminal else None,
                    'total_lkr': 0.0,
                    'total_usd': 0.0,
                    'order_count': 0,
                }
            row = terminal_map[key]
            row['order_count'] += 1
            if o.currency == 'LKR':
                row['total_lkr'] += o.total_amount
            else:
                row['total_usd'] += o.total_amount

        result = []
        for row in terminal_map.values():
            row['total_lkr'] = round(row['total_lkr'], 2)
            row['total_usd'] = round(row['total_usd'], 2)
            result.append(row)

        result.sort(key=lambda x: x['total_lkr'], reverse=True)
        return jsonify(result), 200
    finally:
        db.close()


@reports_bp.get('/orders')
def list_orders():
    """
    Paginated order list with filters.

    Query params:
      from, to, outlet_id, terminal_id
      status   — filter by status (default: all non-cancelled)
      page     — page number (default: 1)
      per_page — items per page (default: 50, max: 200)
    """
    from_dt = _parse_dt(request.args.get('from'))
    to_dt = _parse_dt(request.args.get('to'))
    outlet_id = request.args.get('outlet_id', type=int)
    terminal_id = request.args.get('terminal_id', type=int)
    status_filter = request.args.get('status')
    page = max(1, request.args.get('page', 1, type=int))
    per_page = min(200, max(1, request.args.get('per_page', 50, type=int)))

    db = get_db()
    try:
        q = db.query(Order)

        if status_filter:
            q = q.filter(Order.status == status_filter)
        else:
            q = q.filter(~Order.status.in_(_EXCLUDED_STATUSES))

        if from_dt:
            q = q.filter(Order.synced_at >= from_dt)
        if to_dt:
            q = q.filter(Order.synced_at <= to_dt)
        if outlet_id:
            q = q.filter(Order.outlet_id == outlet_id)
        if terminal_id:
            q = q.filter(Order.terminal_id == terminal_id)

        total = q.count()
        orders = q.order_by(Order.synced_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

        return jsonify({
            'page': page,
            'per_page': per_page,
            'total': total,
            'pages': (total + per_page - 1) // per_page,
            'orders': [_order_to_dict(o) for o in orders],
        }), 200
    finally:
        db.close()


# ── Serializer ─────────────────────────────────────────────────────────────────

def _order_to_dict(o):
    return {
        'id': o.id,
        'terminal_id': o.terminal_id,
        'outlet_id': o.outlet_id,
        'terminal_order_ref': o.terminal_order_ref,
        'table_name': o.table_name,
        'currency': o.currency,
        'total_amount': o.total_amount,
        'status': o.status,
        'payment_method': o.payment_method,
        'synced_at': o.synced_at.isoformat() if o.synced_at else None,
        'order_created_at': o.order_created_at.isoformat() if o.order_created_at else None,
        'item_count': len(o.items),
    }
