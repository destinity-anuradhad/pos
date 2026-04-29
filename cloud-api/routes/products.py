import uuid as uuid_lib
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Product, OutletProduct, Category

products_bp = Blueprint('products', __name__)


def _product_to_dict(p, op=None):
    d = {
        'id': p.id,
        'uuid': str(p.uuid),
        'category_id': p.category_id,
        'sku': p.sku,
        'name': p.name,
        'description': p.description,
        'barcode': p.barcode,
        'image_url': p.image_url,
        'default_price_lkr': float(p.default_price_lkr) if p.default_price_lkr is not None else 0.0,
        'default_price_usd': float(p.default_price_usd) if p.default_price_usd is not None else 0.0,
        'default_cost': float(p.default_cost) if p.default_cost is not None else None,
        'vat_rate_override': float(p.vat_rate_override) if p.vat_rate_override is not None else None,
        'unit': p.unit,
        'is_taxable': p.is_taxable,
        'track_stock': p.track_stock,
        'is_active': p.is_active,
        'created_at': p.created_at.isoformat() if p.created_at else None,
        'updated_at': p.updated_at.isoformat() if p.updated_at else None,
    }
    if op is not None:
        d['outlet_product_uuid'] = str(op.uuid)
        d['outlet_product_id'] = op.id
        d['price_lkr'] = float(op.price_lkr_override) if op.price_lkr_override is not None else d['default_price_lkr']
        d['price_usd'] = float(op.price_usd_override) if op.price_usd_override is not None else d['default_price_usd']
        d['cost'] = float(op.cost_override) if op.cost_override is not None else d['default_cost']
        d['stock_quantity'] = float(op.stock_quantity) if op.stock_quantity is not None else 0.0
        d['reorder_threshold'] = float(op.reorder_threshold) if op.reorder_threshold is not None else None
        d['is_available'] = op.is_available
        d['last_stock_update_at'] = op.last_stock_update_at.isoformat() if op.last_stock_update_at else None
    else:
        d['price_lkr'] = d['default_price_lkr']
        d['price_usd'] = d['default_price_usd']
    return d


def _outlet_product_to_dict(op):
    return {
        'id': op.id,
        'uuid': str(op.uuid),
        'outlet_id': op.outlet_id,
        'product_id': op.product_id,
        'price_lkr_override': float(op.price_lkr_override) if op.price_lkr_override is not None else None,
        'price_usd_override': float(op.price_usd_override) if op.price_usd_override is not None else None,
        'cost_override': float(op.cost_override) if op.cost_override is not None else None,
        'stock_quantity': float(op.stock_quantity) if op.stock_quantity is not None else 0.0,
        'reorder_threshold': float(op.reorder_threshold) if op.reorder_threshold is not None else None,
        'is_available': op.is_available,
        'last_stock_update_at': op.last_stock_update_at.isoformat() if op.last_stock_update_at else None,
        'updated_at': op.updated_at.isoformat() if op.updated_at else None,
    }


@products_bp.route('/', methods=['GET'])
def list_products():
    db = get_db()
    try:
        outlet_id = request.args.get('outlet_id', type=int)
        category_id = request.args.get('category_id', type=int)
        search = request.args.get('search', '').strip()
        skip = request.args.get('skip', 0, type=int)
        limit = min(request.args.get('limit', 100, type=int), 500)

        q = db.query(Product).filter(Product.is_active == True)  # noqa: E712
        if category_id:
            q = q.filter(Product.category_id == category_id)
        if search:
            q = q.filter(
                (Product.name.ilike(f'%{search}%')) |
                (Product.barcode.ilike(f'%{search}%')) |
                (Product.sku.ilike(f'%{search}%'))
            )

        products = q.order_by(Product.name).offset(skip).limit(limit).all()

        result = []
        for p in products:
            op = None
            if outlet_id:
                op = db.query(OutletProduct).filter(
                    OutletProduct.outlet_id == outlet_id,
                    OutletProduct.product_id == p.id,
                ).first()
            result.append(_product_to_dict(p, op))

        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.route('/', methods=['POST'])
def create_product():
    db = get_db()
    try:
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'error': 'name is required'}), 400

        if not data.get('default_price_lkr') and data.get('default_price_lkr') != 0:
            return jsonify({'error': 'default_price_lkr is required'}), 400

        category_id = data.get('category_id')
        if category_id:
            cat = db.query(Category).filter(Category.id == category_id).first()
            if not cat:
                return jsonify({'error': f'Category {category_id} not found'}), 400

        now = datetime.now(timezone.utc)
        product = Product(
            uuid=str(uuid_lib.uuid4()),
            category_id=category_id,
            sku=data.get('sku'),
            name=name,
            description=data.get('description'),
            barcode=data.get('barcode'),
            image_url=data.get('image_url'),
            default_price_lkr=float(data.get('default_price_lkr', 0)),
            default_price_usd=float(data.get('default_price_usd', 0)),
            default_cost=float(data['default_cost']) if data.get('default_cost') is not None else None,
            vat_rate_override=float(data['vat_rate_override']) if data.get('vat_rate_override') is not None else None,
            unit=data.get('unit', 'pcs'),
            is_taxable=bool(data.get('is_taxable', True)),
            track_stock=bool(data.get('track_stock', False)),
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        return jsonify(_product_to_dict(product)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.route('/<int:id>', methods=['PUT'])
def update_product(id):
    db = get_db()
    try:
        product = db.query(Product).filter(Product.id == id).first()
        if not product:
            return jsonify({'error': 'Product not found'}), 404

        data = request.get_json(silent=True) or {}

        for field in ('name', 'description', 'barcode', 'image_url', 'sku',
                      'unit', 'is_taxable', 'track_stock', 'is_active', 'category_id'):
            if field in data:
                setattr(product, field, data[field])

        for num_field in ('default_price_lkr', 'default_price_usd', 'default_cost', 'vat_rate_override'):
            if num_field in data:
                setattr(product, num_field, float(data[num_field]) if data[num_field] is not None else None)

        product.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(product)
        return jsonify(_product_to_dict(product))
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.route('/<int:id>', methods=['DELETE'])
def delete_product(id):
    db = get_db()
    try:
        product = db.query(Product).filter(Product.id == id).first()
        if not product:
            return jsonify({'error': 'Product not found'}), 404

        product.is_active = False
        product.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({'message': 'Product deactivated', 'id': id})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.route('/<int:id>/outlet-products', methods=['POST'])
def upsert_outlet_product(id):
    db = get_db()
    try:
        product = db.query(Product).filter(Product.id == id).first()
        if not product:
            return jsonify({'error': 'Product not found'}), 404

        data = request.get_json(silent=True) or {}
        outlet_id = data.get('outlet_id')
        if not outlet_id:
            return jsonify({'error': 'outlet_id is required'}), 400

        op = db.query(OutletProduct).filter(
            OutletProduct.outlet_id == outlet_id,
            OutletProduct.product_id == id,
        ).first()

        now = datetime.now(timezone.utc)
        if op:
            if 'price_lkr_override' in data:
                op.price_lkr_override = float(data['price_lkr_override']) if data['price_lkr_override'] is not None else None
            if 'price_usd_override' in data:
                op.price_usd_override = float(data['price_usd_override']) if data['price_usd_override'] is not None else None
            if 'cost_override' in data:
                op.cost_override = float(data['cost_override']) if data['cost_override'] is not None else None
            if 'stock_quantity' in data:
                op.stock_quantity = float(data['stock_quantity'])
                op.last_stock_update_at = now
            if 'reorder_threshold' in data:
                op.reorder_threshold = float(data['reorder_threshold']) if data['reorder_threshold'] is not None else None
            if 'is_available' in data:
                op.is_available = bool(data['is_available'])
            op.updated_at = now
            status = 200
        else:
            op = OutletProduct(
                uuid=str(uuid_lib.uuid4()),
                outlet_id=outlet_id,
                product_id=id,
                price_lkr_override=float(data['price_lkr_override']) if data.get('price_lkr_override') is not None else None,
                price_usd_override=float(data['price_usd_override']) if data.get('price_usd_override') is not None else None,
                cost_override=float(data['cost_override']) if data.get('cost_override') is not None else None,
                stock_quantity=float(data.get('stock_quantity', 0)),
                reorder_threshold=float(data['reorder_threshold']) if data.get('reorder_threshold') is not None else None,
                is_available=bool(data.get('is_available', True)),
                updated_at=now,
            )
            db.add(op)
            status = 201

        db.commit()
        db.refresh(op)
        return jsonify(_outlet_product_to_dict(op)), status
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.route('/<int:id>/outlet-products', methods=['GET'])
def list_outlet_products(id):
    db = get_db()
    try:
        product = db.query(Product).filter(Product.id == id).first()
        if not product:
            return jsonify({'error': 'Product not found'}), 404

        ops = db.query(OutletProduct).filter(OutletProduct.product_id == id).all()
        return jsonify([_outlet_product_to_dict(op) for op in ops])
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
