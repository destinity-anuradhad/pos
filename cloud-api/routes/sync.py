import time
import uuid as uuid_lib
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify
from sqlalchemy import text
from database import get_db
from models.models import (
    Outlet, Terminal, Staff, Category, OutletCategory,
    Product, OutletProduct, Table, Order, OrderItem, Payment,
    StockMovement, InvoiceCounter, AuditLog, SyncLog, Customer,
)

sync_bp = Blueprint('sync', __name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _write_sync_log(db, outlet_id, terminal_id, terminal_code, sync_type,
                    direction, records_affected, duration_ms, status, error_message):
    try:
        log = SyncLog(
            outlet_id=outlet_id,
            terminal_id=terminal_id,
            terminal_code=terminal_code or '',
            sync_type=sync_type,
            direction=direction,
            records_affected=records_affected,
            duration_ms=duration_ms,
            status=status,
            error_message=error_message,
        )
        db.add(log)
        db.commit()
    except Exception:
        db.rollback()


def _next_invoice_number(db, outlet, counter_type='invoice'):
    """
    Atomically increment and return the next invoice number.
    Uses FOR UPDATE to prevent race conditions.
    """
    year = datetime.now(timezone.utc).year
    prefix = outlet.invoice_prefix or outlet.code

    # Lock the row for update
    counter = db.query(InvoiceCounter).filter(
        InvoiceCounter.outlet_id == outlet.id,
        InvoiceCounter.year == year,
        InvoiceCounter.counter_type == counter_type,
    ).with_for_update().first()

    if counter is None:
        counter = InvoiceCounter(
            outlet_id=outlet.id,
            year=year,
            counter_type=counter_type,
            last_value=0,
            format_pattern='{prefix}/{year}/{seq:06d}',
        )
        db.add(counter)
        db.flush()

    counter.last_value += 1
    seq = counter.last_value
    pattern = counter.format_pattern or '{prefix}/{year}/{seq:06d}'
    invoice_no = pattern.format(prefix=prefix, year=year, seq=seq)
    db.flush()
    return invoice_no


# ---------------------------------------------------------------------------
# Serializers for pull response
# ---------------------------------------------------------------------------

def _category_pull(cat, outlet_override=None):
    d = {
        'id': cat.id,
        'uuid': str(cat.uuid),
        'name': cat.name,
        'color': cat.color,
        'icon': cat.icon,
        'sort_order': cat.sort_order,
        'is_active': cat.is_active,
        'updated_at': cat.updated_at.isoformat() if cat.updated_at else None,
    }
    if outlet_override:
        d['is_visible'] = outlet_override.is_visible
        d['effective_sort_order'] = (
            outlet_override.sort_order_override
            if outlet_override.sort_order_override is not None
            else cat.sort_order
        )
    else:
        d['is_visible'] = True
        d['effective_sort_order'] = cat.sort_order
    return d


def _product_pull(prod, op=None):
    d = {
        'id': prod.id,
        'uuid': str(prod.uuid),
        'category_id': prod.category_id,
        'sku': prod.sku,
        'name': prod.name,
        'description': prod.description,
        'barcode': prod.barcode,
        'image_url': prod.image_url,
        'default_price_lkr': float(prod.default_price_lkr) if prod.default_price_lkr is not None else 0.0,
        'default_price_usd': float(prod.default_price_usd) if prod.default_price_usd is not None else 0.0,
        'vat_rate_override': float(prod.vat_rate_override) if prod.vat_rate_override is not None else None,
        'unit': prod.unit,
        'is_taxable': prod.is_taxable,
        'track_stock': prod.track_stock,
        'is_active': prod.is_active,
        'updated_at': prod.updated_at.isoformat() if prod.updated_at else None,
    }
    if op:
        d['outlet_product_uuid'] = str(op.uuid)
        d['price_lkr'] = float(op.price_lkr_override) if op.price_lkr_override is not None else d['default_price_lkr']
        d['price_usd'] = float(op.price_usd_override) if op.price_usd_override is not None else d['default_price_usd']
        d['stock_quantity'] = float(op.stock_quantity) if op.stock_quantity is not None else 0.0
        d['is_available'] = op.is_available
    else:
        d['outlet_product_uuid'] = None
        d['price_lkr'] = d['default_price_lkr']
        d['price_usd'] = d['default_price_usd']
        d['stock_quantity'] = 0.0
        d['is_available'] = True
    return d


def _table_pull(t):
    return {
        'id': t.id,
        'uuid': str(t.uuid),
        'outlet_id': t.outlet_id,
        'assigned_terminal_id': t.assigned_terminal_id,
        'name': t.name,
        'capacity': t.capacity,
        'section': t.section,
        'is_active': t.is_active,
        'updated_at': t.updated_at.isoformat() if t.updated_at else None,
    }


def _staff_pull(s):
    return {
        'id': s.id,
        'uuid': str(s.uuid),
        'outlet_id': s.outlet_id,
        'username': s.username,
        'display_name': s.display_name,
        'role': s.role,
        'is_active': s.is_active,
        'updated_at': s.updated_at.isoformat() if s.updated_at else None,
    }


def _outlet_pull(o):
    return {
        'id': o.id,
        'uuid': str(o.uuid),
        'code': o.code,
        'name': o.name,
        'address': o.address,
        'phone': o.phone,
        'timezone': o.timezone,
        'currency': o.currency,
        'vat_registration_no': o.vat_registration_no,
        'vat_rate': float(o.vat_rate) if o.vat_rate is not None else None,
        'invoice_prefix': o.invoice_prefix,
        'is_active': o.is_active,
    }


# ---------------------------------------------------------------------------
# GET /pull
# ---------------------------------------------------------------------------

@sync_bp.route('/pull', methods=['GET'])
def pull_master_data():
    t_start = time.monotonic()
    db = get_db()
    try:
        outlet_uuid = request.args.get('outlet_uuid')
        terminal_uuid = request.args.get('terminal_uuid')
        since_raw = request.args.get('since')
        since_dt = _parse_dt(since_raw)

        if not outlet_uuid:
            return jsonify({'error': 'outlet_uuid is required'}), 400
        if not terminal_uuid:
            return jsonify({'error': 'terminal_uuid is required'}), 400

        outlet = db.query(Outlet).filter(Outlet.uuid == outlet_uuid).first()
        if not outlet:
            return jsonify({'error': 'Outlet not found'}), 404

        terminal = db.query(Terminal).filter(Terminal.uuid == terminal_uuid).first()
        if not terminal:
            return jsonify({'error': 'Terminal not found'}), 404

        # Categories (with outlet overrides)
        cat_q = db.query(Category).filter(Category.is_active == True)  # noqa: E712
        if since_dt:
            cat_q = cat_q.filter(Category.updated_at > since_dt)
        categories = cat_q.order_by(Category.sort_order, Category.name).all()

        oc_map = {}
        ocs = db.query(OutletCategory).filter(
            OutletCategory.outlet_id == outlet.id,
            OutletCategory.category_id.in_([c.id for c in categories]),
        ).all()
        for oc in ocs:
            oc_map[oc.category_id] = oc

        category_list = []
        for cat in categories:
            override = oc_map.get(cat.id)
            if override and not override.is_visible:
                continue
            category_list.append(_category_pull(cat, override))

        # Products (with outlet pricing)
        prod_q = db.query(Product).filter(Product.is_active == True)  # noqa: E712
        if since_dt:
            prod_q = prod_q.filter(Product.updated_at > since_dt)
        products = prod_q.order_by(Product.name).all()

        op_map = {}
        ops = db.query(OutletProduct).filter(
            OutletProduct.outlet_id == outlet.id,
            OutletProduct.product_id.in_([p.id for p in products]),
        ).all()
        for op in ops:
            op_map[op.product_id] = op

        product_list = [_product_pull(p, op_map.get(p.id)) for p in products]

        # Tables
        tbl_q = db.query(Table).filter(
            Table.outlet_id == outlet.id,
            Table.is_active == True,  # noqa: E712
        )
        if since_dt:
            tbl_q = tbl_q.filter(Table.updated_at > since_dt)
        tables = tbl_q.order_by(Table.section, Table.name).all()

        # Staff
        staff_q = db.query(Staff).filter(
            Staff.outlet_id == outlet.id,
            Staff.is_active == True,  # noqa: E712
        )
        if since_dt:
            staff_q = staff_q.filter(Staff.updated_at > since_dt)
        staff_list = staff_q.order_by(Staff.display_name).all()

        # Update terminal.last_seen_at
        now = datetime.now(timezone.utc)
        terminal.last_seen_at = now
        terminal.last_sync_at = now
        db.commit()

        duration_ms = int((time.monotonic() - t_start) * 1000)
        records = len(category_list) + len(product_list) + len(tables) + len(staff_list)
        _write_sync_log(
            db,
            outlet_id=outlet.id,
            terminal_id=terminal.id,
            terminal_code=terminal.terminal_code,
            sync_type='pull',
            direction='pull',
            records_affected=records,
            duration_ms=duration_ms,
            status='success',
            error_message=None,
        )

        return jsonify({
            'categories': category_list,
            'products': product_list,
            'tables': [_table_pull(t) for t in tables],
            'staff': [_staff_pull(s) for s in staff_list],
            'outlet': _outlet_pull(outlet),
            'timestamp': now.isoformat(),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /push
# ---------------------------------------------------------------------------

@sync_bp.route('/push', methods=['POST'])
def push_transactions():
    t_start = time.monotonic()
    db = get_db()
    try:
        data = request.get_json(silent=True) or {}
        outlet_uuid = data.get('outlet_uuid')
        terminal_uuid = data.get('terminal_uuid')
        orders_payload = data.get('orders', [])
        stock_movements_payload = data.get('stock_movements', [])
        audit_log_payload = data.get('audit_log', [])

        if not outlet_uuid:
            return jsonify({'error': 'outlet_uuid is required'}), 400
        if not terminal_uuid:
            return jsonify({'error': 'terminal_uuid is required'}), 400

        outlet = db.query(Outlet).filter(Outlet.uuid == outlet_uuid).first()
        if not outlet:
            return jsonify({'error': 'Outlet not found'}), 404

        terminal = db.query(Terminal).filter(Terminal.uuid == terminal_uuid).first()
        if not terminal:
            return jsonify({'error': 'Terminal not found'}), 404

        now = datetime.now(timezone.utc)
        results = []
        total_records = 0

        # ---- Orders -----------------------------------------------------------
        for order_data in orders_payload:
            order_uuid = order_data.get('uuid')
            terminal_order_ref = order_data.get('terminal_order_ref')

            if not terminal_order_ref:
                results.append({
                    'uuid': order_uuid,
                    'terminal_order_ref': terminal_order_ref,
                    'status': 'error',
                    'error': 'terminal_order_ref is required',
                })
                continue

            # Dedup by UUID first, then by (terminal_id, terminal_order_ref)
            existing = None
            if order_uuid:
                existing = db.query(Order).filter(Order.uuid == order_uuid).first()
            if not existing:
                existing = db.query(Order).filter(
                    Order.terminal_id == terminal.id,
                    Order.terminal_order_ref == terminal_order_ref,
                ).first()

            if existing:
                results.append({
                    'uuid': order_uuid,
                    'terminal_order_ref': terminal_order_ref,
                    'tax_invoice_no': existing.tax_invoice_no,
                    'hq_order_id': existing.id,
                    'status': 'already_synced',
                })
                continue

            try:
                # Resolve optional FKs by UUID
                created_by_staff_id = None
                staff_uuid = order_data.get('created_by_staff_uuid')
                if staff_uuid:
                    staff = db.query(Staff).filter(Staff.uuid == staff_uuid).first()
                    if staff:
                        created_by_staff_id = staff.id

                customer_id = None
                customer_uuid = order_data.get('customer_uuid')
                if customer_uuid:
                    cust = db.query(Customer).filter(Customer.uuid == customer_uuid).first()
                    if cust:
                        customer_id = cust.id

                order_created_at = _parse_dt(order_data.get('order_created_at')) or now

                new_order = Order(
                    uuid=order_uuid or str(uuid_lib.uuid4()),
                    outlet_id=outlet.id,
                    terminal_id=terminal.id,
                    created_by_staff_id=created_by_staff_id,
                    customer_id=customer_id,
                    table_uuid=order_data.get('table_uuid'),
                    table_name=order_data.get('table_name'),
                    terminal_order_ref=terminal_order_ref,
                    currency=order_data.get('currency', 'LKR'),
                    subtotal=float(order_data.get('subtotal', 0)),
                    discount_amount=float(order_data.get('discount_amount', 0)),
                    discount_reason=order_data.get('discount_reason'),
                    service_charge=float(order_data.get('service_charge', 0)),
                    tax_amount=float(order_data.get('tax_amount', 0)),
                    total_amount=float(order_data.get('total_amount', 0)),
                    paid_amount=float(order_data.get('paid_amount', 0)),
                    change_amount=float(order_data.get('change_amount', 0)),
                    status=order_data.get('status', 'completed'),
                    notes=order_data.get('notes'),
                    order_created_at=order_created_at,
                    synced_at=now,
                    updated_at=now,
                )
                db.add(new_order)
                db.flush()  # get new_order.id

                # Assign tax invoice number
                invoice_no = _next_invoice_number(db, outlet)
                new_order.tax_invoice_no = invoice_no
                new_order.tax_invoice_issued_at = now
                db.flush()

                # Order items
                for item_data in order_data.get('items', []):
                    item = OrderItem(
                        uuid=item_data.get('uuid') or str(uuid_lib.uuid4()),
                        order_id=new_order.id,
                        product_uuid=item_data.get('product_uuid'),
                        product_id=item_data.get('product_id'),
                        product_name=item_data.get('product_name', 'Unknown'),
                        product_sku=item_data.get('product_sku'),
                        quantity=float(item_data.get('quantity', 1)),
                        unit_price=float(item_data.get('unit_price', 0)),
                        discount_amount=float(item_data.get('discount_amount', 0)),
                        vat_rate=float(item_data.get('vat_rate', 0)),
                        vat_amount=float(item_data.get('vat_amount', 0)),
                        line_total=float(item_data.get('line_total', 0)),
                        notes=item_data.get('notes'),
                        created_at=now,
                    )
                    db.add(item)

                # Payments
                for pay_data in order_data.get('payments', []):
                    payment = Payment(
                        uuid=pay_data.get('uuid') or str(uuid_lib.uuid4()),
                        order_id=new_order.id,
                        payment_method=pay_data.get('payment_method', 'cash'),
                        amount=float(pay_data.get('amount', 0)),
                        currency=pay_data.get('currency', 'LKR'),
                        card_last4=pay_data.get('card_last4'),
                        card_brand=pay_data.get('card_brand'),
                        transaction_ref=pay_data.get('transaction_ref'),
                        status=pay_data.get('status', 'success'),
                        paid_at=_parse_dt(pay_data.get('paid_at')) or now,
                        created_at=now,
                    )
                    db.add(payment)

                db.commit()
                total_records += 1
                results.append({
                    'uuid': order_uuid,
                    'terminal_order_ref': terminal_order_ref,
                    'tax_invoice_no': invoice_no,
                    'hq_order_id': new_order.id,
                    'status': 'synced',
                })

            except Exception as e:
                db.rollback()
                results.append({
                    'uuid': order_uuid,
                    'terminal_order_ref': terminal_order_ref,
                    'status': 'error',
                    'error': str(e),
                })

        # ---- Stock movements --------------------------------------------------
        for sm_data in stock_movements_payload:
            try:
                op = None
                op_uuid = sm_data.get('outlet_product_uuid')
                if op_uuid:
                    op = db.query(OutletProduct).filter(OutletProduct.uuid == op_uuid).first()

                if not op:
                    product_id = sm_data.get('product_id')
                    if product_id:
                        op = db.query(OutletProduct).filter(
                            OutletProduct.outlet_id == outlet.id,
                            OutletProduct.product_id == product_id,
                        ).first()

                if not op:
                    continue

                qty_change = float(sm_data.get('quantity_change', 0))
                op.stock_quantity = float(op.stock_quantity or 0) + qty_change
                op.last_stock_update_at = now
                op.updated_at = now

                sm = StockMovement(
                    uuid=sm_data.get('uuid') or str(uuid_lib.uuid4()),
                    outlet_id=outlet.id,
                    outlet_product_id=op.id,
                    terminal_id=terminal.id,
                    movement_type=sm_data.get('movement_type', 'sale'),
                    quantity_change=qty_change,
                    stock_after=float(op.stock_quantity),
                    unit_cost=float(sm_data['unit_cost']) if sm_data.get('unit_cost') is not None else None,
                    reference_type=sm_data.get('reference_type'),
                    reference_uuid=sm_data.get('reference_uuid'),
                    reason=sm_data.get('reason'),
                    created_at=_parse_dt(sm_data.get('created_at')) or now,
                )
                db.add(sm)
                db.flush()
                total_records += 1

            except Exception:
                db.rollback()

        db.commit()

        # ---- Audit log entries ------------------------------------------------
        for al_data in audit_log_payload:
            try:
                al = AuditLog(
                    uuid=al_data.get('uuid') or str(uuid_lib.uuid4()),
                    outlet_id=outlet.id,
                    terminal_id=terminal.id,
                    staff_id=al_data.get('staff_id'),
                    action=al_data.get('action', 'unknown'),
                    entity_type=al_data.get('entity_type'),
                    entity_uuid=al_data.get('entity_uuid'),
                    details=al_data.get('details'),
                    ip_address=al_data.get('ip_address'),
                    user_agent=al_data.get('user_agent'),
                    occurred_at=_parse_dt(al_data.get('occurred_at')) or now,
                    synced_at=now,
                )
                db.add(al)
                db.flush()
                total_records += 1
            except Exception:
                db.rollback()

        db.commit()

        # Update terminal last_sync_at
        terminal.last_seen_at = now
        terminal.last_sync_at = now
        try:
            db.commit()
        except Exception:
            db.rollback()

        duration_ms = int((time.monotonic() - t_start) * 1000)
        error_count = sum(1 for r in results if r.get('status') == 'error')
        synced_count = sum(1 for r in results if r.get('status') == 'synced')
        status = 'success' if error_count == 0 else ('partial' if synced_count > 0 else 'failed')

        _write_sync_log(
            db,
            outlet_id=outlet.id,
            terminal_id=terminal.id,
            terminal_code=terminal.terminal_code,
            sync_type='push',
            direction='push',
            records_affected=total_records,
            duration_ms=duration_ms,
            status=status,
            error_message=None,
        )

        return jsonify({
            'synced': synced_count,
            'errors': error_count,
            'results': results,
        })
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
