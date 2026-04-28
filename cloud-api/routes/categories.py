from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Category

categories_bp = Blueprint('categories', __name__)


def _category_to_dict(c):
    return {
        'id': c.id,
        'name': c.name,
        'color': c.color,
        'is_active': c.is_active,
        'created_at': c.created_at.isoformat() if c.created_at else None,
        'updated_at': c.updated_at.isoformat() if c.updated_at else None,
    }


@categories_bp.get('/')
def list_categories():
    db = get_db()
    try:
        active_only = request.args.get('active_only', 'false').lower() == 'true'
        q = db.query(Category)
        if active_only:
            q = q.filter(Category.is_active == True)  # noqa: E712
        categories = q.order_by(Category.name).all()
        return jsonify([_category_to_dict(c) for c in categories]), 200
    finally:
        db.close()


@categories_bp.get('/<int:category_id>')
def get_category(category_id):
    db = get_db()
    try:
        cat = db.query(Category).filter(Category.id == category_id).first()
        if not cat:
            return jsonify({'error': 'Category not found'}), 404
        return jsonify(_category_to_dict(cat)), 200
    finally:
        db.close()


@categories_bp.post('/')
def create_category():
    """
    Payload: { "name": "Snacks", "color": "#f97316" }
    """
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    db = get_db()
    try:
        cat = Category(
            name=name,
            color=data.get('color', '#6b7280'),
            is_active=data.get('is_active', True),
        )
        db.add(cat)
        db.commit()
        db.refresh(cat)
        return jsonify(_category_to_dict(cat)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@categories_bp.put('/<int:category_id>')
def update_category(category_id):
    db = get_db()
    try:
        cat = db.query(Category).filter(Category.id == category_id).first()
        if not cat:
            return jsonify({'error': 'Category not found'}), 404

        data = request.get_json(silent=True) or {}
        if 'name' in data:
            cat.name = data['name']
        if 'color' in data:
            cat.color = data['color']
        if 'is_active' in data:
            cat.is_active = bool(data['is_active'])

        db.commit()
        db.refresh(cat)
        return jsonify(_category_to_dict(cat)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@categories_bp.delete('/<int:category_id>')
def delete_category(category_id):
    """Soft delete — sets is_active = False."""
    db = get_db()
    try:
        cat = db.query(Category).filter(Category.id == category_id).first()
        if not cat:
            return jsonify({'error': 'Category not found'}), 404
        cat.is_active = False
        db.commit()
        return jsonify({'message': 'Category deactivated', 'id': category_id}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
