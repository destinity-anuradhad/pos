"""Product routes."""
import uuid
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from models.models import Product, Category
from utils import db_session
from auth_utils import require_auth

products_bp = Blueprint('products', __name__)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _product_dict(p: Product) -> dict:
    return {
        'id': p.id,
        'uuid': p.uuid,
        'outlet_product_uuid': p.outlet_product_uuid,
        'category_id': p.category_id,
        'name': p.name,
        'sku': p.sku,
        'barcode': p.barcode,
        'image_url': p.image_url,
        'price_lkr': p.price_lkr,
        'price_usd': p.price_usd,
        'vat_rate': p.vat_rate,
        'unit': p.unit,
        'track_stock': p.track_stock,
        'stock_quantity': p.stock_quantity,
        'is_available': p.is_available,
        'updated_at': p.updated_at.isoformat() if p.updated_at else None,
        'synced_at': p.synced_at.isoformat() if p.synced_at else None,
    }


@products_bp.route('/', methods=['GET'])
def list_products():
    category_id = request.args.get('category_id', type=int)
    search = request.args.get('search', '').strip()
    skip = request.args.get('skip', 0, type=int)
    limit = min(request.args.get('limit', 100, type=int), 500)

    db = db_session()
    try:
        q = db.query(Product).filter(Product.is_available == True)

        if category_id:
            q = q.filter(Product.category_id == category_id)
        if search:
            q = q.filter(Product.name.ilike(f'%{search}%'))

        products = q.order_by(Product.name).offset(skip).limit(limit).all()
        return jsonify([_product_dict(p) for p in products]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.route('/<int:id>', methods=['GET'])
def get_product(id):
    db = db_session()
    try:
        p = db.query(Product).filter(Product.id == id).first()
        if not p:
            return jsonify({'error': 'Product not found'}), 404
        return jsonify(_product_dict(p)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.route('/', methods=['POST'])
@require_auth(roles=['manager', 'admin'])
def create_product():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    price_lkr = data.get('price_lkr')
    if price_lkr is None:
        return jsonify({'error': 'price_lkr is required'}), 400

    db = db_session()
    try:
        category_id = data.get('category_id')
        if category_id:
            cat = db.query(Category).filter(Category.id == category_id).first()
            if not cat:
                return jsonify({'error': 'Category not found'}), 400

        p = Product(
            uuid=str(uuid.uuid4()),
            outlet_product_uuid=str(uuid.uuid4()),
            category_id=category_id,
            name=name,
            sku=data.get('sku'),
            barcode=data.get('barcode'),
            image_url=data.get('image_url'),
            price_lkr=float(price_lkr),
            price_usd=float(data['price_usd']) if data.get('price_usd') is not None else None,
            vat_rate=float(data.get('vat_rate', 0)),
            unit=data.get('unit'),
            track_stock=bool(data.get('track_stock', False)),
            stock_quantity=float(data.get('stock_quantity', 0)),
            is_available=True,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        return jsonify(_product_dict(p)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.route('/<int:id>', methods=['PUT'])
@require_auth(roles=['manager', 'admin'])
def update_product(id):
    data = request.get_json(silent=True) or {}
    db = db_session()
    try:
        p = db.query(Product).filter(Product.id == id).first()
        if not p:
            return jsonify({'error': 'Product not found'}), 404

        if 'name' in data:
            p.name = data['name']
        if 'category_id' in data:
            p.category_id = data['category_id']
        if 'sku' in data:
            p.sku = data['sku']
        if 'barcode' in data:
            p.barcode = data['barcode']
        if 'image_url' in data:
            p.image_url = data['image_url']
        if 'price_lkr' in data:
            p.price_lkr = float(data['price_lkr'])
        if 'price_usd' in data:
            p.price_usd = float(data['price_usd']) if data['price_usd'] is not None else None
        if 'vat_rate' in data:
            p.vat_rate = float(data['vat_rate'])
        if 'unit' in data:
            p.unit = data['unit']
        if 'track_stock' in data:
            p.track_stock = bool(data['track_stock'])
        if 'stock_quantity' in data:
            p.stock_quantity = float(data['stock_quantity'])
        if 'is_available' in data:
            p.is_available = bool(data['is_available'])

        p.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(p)
        return jsonify(_product_dict(p)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.route('/<int:id>', methods=['DELETE'])
@require_auth(roles=['manager', 'admin'])
def delete_product(id):
    db = db_session()
    try:
        p = db.query(Product).filter(Product.id == id).first()
        if not p:
            return jsonify({'error': 'Product not found'}), 404

        # Soft delete
        p.is_available = False
        p.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({'message': 'Product deactivated'}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
