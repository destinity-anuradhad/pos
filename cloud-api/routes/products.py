from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Product, Category

products_bp = Blueprint('products', __name__)


def _product_to_dict(p, include_category=False):
    d = {
        'id': p.id,
        'category_id': p.category_id,
        'name': p.name,
        'price_lkr': p.price_lkr,
        'price_usd': p.price_usd,
        'barcode': p.barcode,
        'stock_quantity': p.stock_quantity,
        'is_active': p.is_active,
        'created_at': p.created_at.isoformat() if p.created_at else None,
        'updated_at': p.updated_at.isoformat() if p.updated_at else None,
    }
    if include_category and p.category:
        d['category'] = {'id': p.category.id, 'name': p.category.name, 'color': p.category.color}
    return d


@products_bp.get('/')
def list_products():
    """
    Query params:
      ?category_id=1
      ?active_only=true
      ?include_category=true
    """
    db = get_db()
    try:
        category_id = request.args.get('category_id', type=int)
        active_only = request.args.get('active_only', 'false').lower() == 'true'
        include_category = request.args.get('include_category', 'false').lower() == 'true'

        q = db.query(Product)
        if category_id:
            q = q.filter(Product.category_id == category_id)
        if active_only:
            q = q.filter(Product.is_active == True)  # noqa: E712

        products = q.order_by(Product.name).all()
        return jsonify([_product_to_dict(p, include_category) for p in products]), 200
    finally:
        db.close()


@products_bp.get('/<int:product_id>')
def get_product(product_id):
    db = get_db()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product:
            return jsonify({'error': 'Product not found'}), 404
        return jsonify(_product_to_dict(product, include_category=True)), 200
    finally:
        db.close()


@products_bp.post('/')
def create_product():
    """
    Payload:
    {
      "name": "Burger",
      "category_id": 1,
      "price_lkr": 750,
      "price_usd": 2.5,
      "barcode": "1234567890",
      "stock_quantity": -1
    }
    """
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    db = get_db()
    try:
        # Validate category if provided
        category_id = data.get('category_id')
        if category_id:
            cat = db.query(Category).filter(Category.id == category_id).first()
            if not cat:
                return jsonify({'error': f"Category {category_id} not found"}), 400

        product = Product(
            name=name,
            category_id=category_id,
            price_lkr=float(data.get('price_lkr', 0)),
            price_usd=float(data.get('price_usd', 0)),
            barcode=data.get('barcode'),
            stock_quantity=int(data.get('stock_quantity', -1)),
            is_active=data.get('is_active', True),
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        return jsonify(_product_to_dict(product, include_category=True)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.put('/<int:product_id>')
def update_product(product_id):
    db = get_db()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product:
            return jsonify({'error': 'Product not found'}), 404

        data = request.get_json(silent=True) or {}

        if 'name' in data:
            product.name = data['name']
        if 'category_id' in data:
            product.category_id = data['category_id']
        if 'price_lkr' in data:
            product.price_lkr = float(data['price_lkr'])
        if 'price_usd' in data:
            product.price_usd = float(data['price_usd'])
        if 'barcode' in data:
            product.barcode = data['barcode']
        if 'stock_quantity' in data:
            product.stock_quantity = int(data['stock_quantity'])
        if 'is_active' in data:
            product.is_active = bool(data['is_active'])

        db.commit()
        db.refresh(product)
        return jsonify(_product_to_dict(product, include_category=True)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@products_bp.delete('/<int:product_id>')
def delete_product(product_id):
    """Soft delete — sets is_active = False."""
    db = get_db()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product:
            return jsonify({'error': 'Product not found'}), 404
        product.is_active = False
        db.commit()
        return jsonify({'message': 'Product deactivated', 'id': product_id}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
