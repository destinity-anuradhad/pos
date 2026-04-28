"""
Input validation helpers shared by all route handlers.
"""
from flask import jsonify

# ── Allowed enum values ───────────────────────────────────────────────────────
VALID_ORDER_STATUSES   = {'pending', 'completed', 'cancelled'}
VALID_PAYMENT_METHODS  = {'cash', 'card', 'online', ''}
VALID_CURRENCIES       = {'LKR', 'USD'}
VALID_SYNC_STATUSES    = {'pending', 'synced', 'failed'}
MAX_PAGINATION_LIMIT   = 500   # never return more than 500 rows in one call

# ── Field length limits ───────────────────────────────────────────────────────
MAX_NAME_LEN    = 200
MAX_BARCODE_LEN = 100
MAX_COLOR_LEN   = 20
MAX_NOTES_LEN   = 1000


def _err(msg, code=400):
    return jsonify({'error': msg}), code


def validate_product(data: dict):
    """Validate product create/update payload. Returns (None, None) on success or (response, code)."""
    name = (data.get('name') or '').strip()
    if not name:
        return _err('Product name is required')
    if len(name) > MAX_NAME_LEN:
        return _err(f'Product name too long (max {MAX_NAME_LEN} chars)')

    barcode = (data.get('barcode') or '').strip()
    if len(barcode) > MAX_BARCODE_LEN:
        return _err(f'Barcode too long (max {MAX_BARCODE_LEN} chars)')

    for field in ('price_lkr', 'price_usd'):
        if field in data:
            try:
                v = float(data[field])
            except (TypeError, ValueError):
                return _err(f'{field} must be a number')
            if v < 0:
                return _err(f'{field} cannot be negative')
            if v > 10_000_000:
                return _err(f'{field} exceeds maximum allowed value')

    if 'stock_quantity' in data:
        try:
            sq = int(data['stock_quantity'])
        except (TypeError, ValueError):
            return _err('stock_quantity must be an integer')
        if sq < -1:
            return _err('stock_quantity must be -1 (unlimited) or >= 0')

    category = (data.get('category') or '').strip()
    if len(category) > MAX_NAME_LEN:
        return _err(f'Category name too long (max {MAX_NAME_LEN} chars)')

    return None, None


def validate_category(data: dict):
    name = (data.get('name') or '').strip()
    if not name:
        return _err('Category name is required')
    if len(name) > MAX_NAME_LEN:
        return _err(f'Category name too long (max {MAX_NAME_LEN} chars)')
    color = (data.get('color') or '').strip()
    if color and len(color) > MAX_COLOR_LEN:
        return _err(f'Color value too long (max {MAX_COLOR_LEN} chars)')
    return None, None


def validate_table(data: dict):
    name = (data.get('name') or '').strip()
    if not name:
        return _err('Table name is required')
    if len(name) > MAX_NAME_LEN:
        return _err(f'Table name too long (max {MAX_NAME_LEN} chars)')
    if 'capacity' in data:
        try:
            cap = int(data['capacity'])
        except (TypeError, ValueError):
            return _err('Capacity must be an integer')
        if cap < 1 or cap > 100:
            return _err('Capacity must be between 1 and 100')
    return None, None


def validate_order(data: dict):
    status = data.get('status', 'pending')
    if status not in VALID_ORDER_STATUSES:
        return _err(f'Invalid status "{status}". Allowed: {sorted(VALID_ORDER_STATUSES)}')

    currency = data.get('currency', 'LKR')
    if currency not in VALID_CURRENCIES:
        return _err(f'Invalid currency "{currency}". Allowed: {sorted(VALID_CURRENCIES)}')

    payment = (data.get('payment_method') or '').strip()
    if payment and payment not in VALID_PAYMENT_METHODS:
        return _err(f'Invalid payment_method "{payment}". Allowed: {sorted(VALID_PAYMENT_METHODS - {""})}')

    try:
        total = float(data.get('total_amount', 0))
    except (TypeError, ValueError):
        return _err('total_amount must be a number')
    if total < 0:
        return _err('total_amount cannot be negative')
    if total > 100_000_000:
        return _err('total_amount exceeds maximum allowed value')

    items = data.get('items', [])
    if not isinstance(items, list):
        return _err('items must be a list')
    for i, item in enumerate(items):
        try:
            qty = int(item.get('quantity', 0))
        except (TypeError, ValueError):
            return _err(f'Item {i}: quantity must be an integer')
        if qty < 1:
            return _err(f'Item {i}: quantity must be at least 1')
        if qty > 10_000:
            return _err(f'Item {i}: quantity too large')
        try:
            up = float(item.get('unit_price', 0))
        except (TypeError, ValueError):
            return _err(f'Item {i}: unit_price must be a number')
        if up < 0:
            return _err(f'Item {i}: unit_price cannot be negative')
        try:
            st = float(item.get('subtotal', 0))
        except (TypeError, ValueError):
            return _err(f'Item {i}: subtotal must be a number')
        if st < 0:
            return _err(f'Item {i}: subtotal cannot be negative')

    return None, None


def validate_order_status(status: str):
    if status not in VALID_ORDER_STATUSES:
        return _err(f'Invalid status "{status}". Allowed: {sorted(VALID_ORDER_STATUSES)}')
    return None, None


def safe_pagination(skip_str, limit_str):
    """Parse and clamp skip/limit query params."""
    try:
        skip  = max(0, int(skip_str or 0))
        limit = max(1, min(int(limit_str or 50), MAX_PAGINATION_LIMIT))
    except (TypeError, ValueError):
        skip, limit = 0, 50
    return skip, limit
