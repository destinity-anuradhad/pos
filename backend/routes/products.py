from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Product

products_bp = Blueprint('products', __name__)

def product_to_dict(p):
    return {
        'id': p.id, 'name': p.name, 'category_id': p.category_id,
        'price_lkr': p.price_lkr, 'price_usd': p.price_usd,
        'barcode': p.barcode, 'image_url': p.image_url, 'is_active': p.is_active
    }

@products_bp.get('/')
def get_products():
    db = db_session()
    try:
        skip  = int(request.args.get('skip', 0))
        limit = int(request.args.get('limit', 100))
        products = db.query(Product).filter(Product.is_active == True).offset(skip).limit(limit).all()
        return jsonify([product_to_dict(p) for p in products])
    finally:
        db.close()

@products_bp.get('/barcode/<barcode>')
def get_product_by_barcode(barcode):
    db = db_session()
    try:
        p = db.query(Product).filter(Product.barcode == barcode).first()
        if not p: return jsonify({'error': 'Product not found'}), 404
        return jsonify(product_to_dict(p))
    finally:
        db.close()

@products_bp.get('/<int:product_id>')
def get_product(product_id):
    db = db_session()
    try:
        p = db.query(Product).filter(Product.id == product_id).first()
        if not p: return jsonify({'error': 'Product not found'}), 404
        return jsonify(product_to_dict(p))
    finally:
        db.close()

@products_bp.post('/')
def create_product():
    db = db_session()
    try:
        data = request.get_json()
        p = Product(
            name=data['name'], category_id=data.get('category_id'),
            price_lkr=data.get('price_lkr', 0), price_usd=data.get('price_usd', 0),
            barcode=data.get('barcode'), image_url=data.get('image_url'),
            is_active=data.get('is_active', True)
        )
        db.add(p); db.commit(); db.refresh(p)
        return jsonify(product_to_dict(p)), 201
    finally:
        db.close()

@products_bp.put('/<int:product_id>')
def update_product(product_id):
    db = db_session()
    try:
        p = db.query(Product).filter(Product.id == product_id).first()
        if not p: return jsonify({'error': 'Product not found'}), 404
        data = request.get_json()
        for key in ['name','category_id','price_lkr','price_usd','barcode','image_url','is_active']:
            if key in data: setattr(p, key, data[key])
        db.commit(); db.refresh(p)
        return jsonify(product_to_dict(p))
    finally:
        db.close()

@products_bp.delete('/<int:product_id>')
def delete_product(product_id):
    db = db_session()
    try:
        p = db.query(Product).filter(Product.id == product_id).first()
        if not p: return jsonify({'error': 'Product not found'}), 404
        p.is_active = False; db.commit()
        return jsonify({'message': 'Product deleted'})
    finally:
        db.close()
