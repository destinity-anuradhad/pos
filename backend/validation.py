"""Validation helpers and enum constants for local backend (v2)."""

# ── Enum constants ────────────────────────────────────────────────────────────
VALID_ORDER_STATUSES    = {'pending', 'completed', 'cancelled', 'refunded'}
VALID_PAYMENT_METHODS   = {'cash', 'card', 'online', 'wallet', 'credit', 'voucher', ''}
VALID_CURRENCIES        = {'LKR', 'USD'}
VALID_SYNC_STATUSES     = {'pending', 'syncing', 'synced', 'failed'}
VALID_STAFF_ROLES       = {'cashier', 'manager', 'admin'}
VALID_MOVEMENT_TYPES    = {
    'sale', 'refund', 'restock', 'adjustment',
    'damage', 'transfer_in', 'transfer_out', 'opening',
}
VALID_TRIGGER_TYPES     = {'manual', 'auto'}
VALID_PLATFORMS         = {'web', 'windows', 'android', 'ios', 'macos'}

# ── Field length limits ───────────────────────────────────────────────────────
MAX_NAME_LEN        = 200
MAX_BARCODE_LEN     = 100
MAX_SKU_LEN         = 100
MAX_COLOR_LEN       = 20
MAX_NOTES_LEN       = 1000
MAX_REASON_LEN      = 500

# ── Numeric ranges ────────────────────────────────────────────────────────────
MAX_PRICE           = 10_000_000
MAX_TOTAL           = 100_000_000
MAX_QUANTITY        = 10_000
MIN_STOCK           = -1        # -1 = unlimited
MAX_CAPACITY        = 100
MIN_CAPACITY        = 1
MAX_PAGINATION      = 500


# ── Validators ────────────────────────────────────────────────────────────────

def validate_product(data: dict):
    """Return error message string or None if valid."""
    name = (data.get('name') or '').strip()
    if not name:
        return 'name is required'
    if len(name) > MAX_NAME_LEN:
        return f'name must be <= {MAX_NAME_LEN} characters'

    for field in ('price_lkr', 'price_usd'):
        val = data.get(field)
        if val is not None:
            try:
                v = float(val)
            except (TypeError, ValueError):
                return f'{field} must be a number'
            if not (0 <= v <= MAX_PRICE):
                return f'{field} must be between 0 and {MAX_PRICE}'

    barcode = data.get('barcode')
    if barcode and len(str(barcode)) > MAX_BARCODE_LEN:
        return f'barcode must be <= {MAX_BARCODE_LEN} characters'

    sku = data.get('sku')
    if sku and len(str(sku)) > MAX_SKU_LEN:
        return f'sku must be <= {MAX_SKU_LEN} characters'

    stock = data.get('stock_quantity')
    if stock is not None:
        try:
            s = float(stock)
        except (TypeError, ValueError):
            return 'stock_quantity must be a number'
        if s < MIN_STOCK:
            return f'stock_quantity must be >= {MIN_STOCK} (-1 = unlimited)'

    vat = data.get('vat_rate')
    if vat is not None:
        try:
            v = float(vat)
        except (TypeError, ValueError):
            return 'vat_rate must be a number'
        if not (0 <= v <= 100):
            return 'vat_rate must be between 0 and 100'

    return None


def validate_category(data: dict):
    name = (data.get('name') or '').strip()
    if not name:
        return 'name is required'
    if len(name) > MAX_NAME_LEN:
        return f'name must be <= {MAX_NAME_LEN} characters'
    color = data.get('color')
    if color and len(str(color)) > MAX_COLOR_LEN:
        return f'color must be <= {MAX_COLOR_LEN} characters'
    return None


def validate_table(data: dict):
    name = (data.get('name') or '').strip()
    if not name:
        return 'name is required'
    if len(name) > MAX_NAME_LEN:
        return f'name must be <= {MAX_NAME_LEN} characters'
    cap = data.get('capacity')
    if cap is not None:
        try:
            c = int(cap)
        except (TypeError, ValueError):
            return 'capacity must be an integer'
        if not (MIN_CAPACITY <= c <= MAX_CAPACITY):
            return f'capacity must be between {MIN_CAPACITY} and {MAX_CAPACITY}'
    return None


def validate_order(data: dict):
    items = data.get('items')
    if not items or not isinstance(items, list) or len(items) == 0:
        return 'items is required and must be a non-empty list'
    for i, item in enumerate(items):
        qty = item.get('quantity', 1)
        try:
            q = float(qty)
        except (TypeError, ValueError):
            return f'item[{i}].quantity must be a number'
        if not (0 < q <= MAX_QUANTITY):
            return f'item[{i}].quantity must be between 0 and {MAX_QUANTITY}'
        price = item.get('unit_price', 0)
        try:
            p = float(price)
        except (TypeError, ValueError):
            return f'item[{i}].unit_price must be a number'
        if p < 0:
            return f'item[{i}].unit_price must be >= 0'
    currency = data.get('currency', 'LKR')
    if currency not in VALID_CURRENCIES:
        return f'currency must be one of {sorted(VALID_CURRENCIES)}'
    return None


def validate_order_status(status: str):
    if status not in VALID_ORDER_STATUSES:
        return f'status must be one of {sorted(VALID_ORDER_STATUSES)}'
    return None


def validate_payment(data: dict):
    method = data.get('payment_method', '')
    if method not in VALID_PAYMENT_METHODS:
        return f'payment_method must be one of {sorted(VALID_PAYMENT_METHODS)}'
    amount = data.get('amount')
    try:
        a = float(amount)
    except (TypeError, ValueError):
        return 'amount must be a number'
    if a <= 0:
        return 'amount must be > 0'
    return None


def safe_pagination(skip=0, limit=50, max_limit=MAX_PAGINATION):
    try:
        skip = max(0, int(skip))
    except (TypeError, ValueError):
        skip = 0
    try:
        limit = min(max(1, int(limit)), max_limit)
    except (TypeError, ValueError):
        limit = 50
    return skip, limit
