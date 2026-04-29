"""Category routes."""
import uuid
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from models.models import Category, Product
from utils import db_session
from auth_utils import require_auth

categories_bp = Blueprint('categories', __name__)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _cat_dict(c: Category) -> dict:
    return {
        'id': c.id,
        'uuid': c.uuid,
        'name': c.name,
        'color': c.color,
        'icon': c.icon,
        'sort_order': c.sort_order,
        'is_visible': c.is_visible,
        'updated_at': c.updated_at.isoformat() if c.updated_at else None,
        'synced_at': c.synced_at.isoformat() if c.synced_at else None,
    }


@categories_bp.route('/', methods=['GET'])
def list_categories():
    db = db_session()
    try:
        cats = (
            db.query(Category)
            .filter(Category.is_visible == True)
            .order_by(Category.sort_order)
            .all()
        )
        return jsonify([_cat_dict(c) for c in cats]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@categories_bp.route('/', methods=['POST'])
@require_auth(roles=['manager', 'admin'])
def create_category():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    db = db_session()
    try:
        c = Category(
            uuid=str(uuid.uuid4()),
            name=name,
            color=data.get('color'),
            icon=data.get('icon'),
            sort_order=data.get('sort_order', 0),
            is_visible=True,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        return jsonify(_cat_dict(c)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@categories_bp.route('/<int:id>', methods=['PUT'])
@require_auth(roles=['manager', 'admin'])
def update_category(id):
    data = request.get_json(silent=True) or {}
    db = db_session()
    try:
        c = db.query(Category).filter(Category.id == id).first()
        if not c:
            return jsonify({'error': 'Category not found'}), 404

        if 'name' in data:
            c.name = data['name']
        if 'color' in data:
            c.color = data['color']
        if 'icon' in data:
            c.icon = data['icon']
        if 'sort_order' in data:
            c.sort_order = data['sort_order']
        if 'is_visible' in data:
            c.is_visible = bool(data['is_visible'])

        c.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(c)
        return jsonify(_cat_dict(c)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@categories_bp.route('/<int:id>', methods=['DELETE'])
@require_auth(roles=['manager', 'admin'])
def delete_category(id):
    db = db_session()
    try:
        c = db.query(Category).filter(Category.id == id).first()
        if not c:
            return jsonify({'error': 'Category not found'}), 404

        # Prevent deletion if products reference this category
        linked = db.query(Product).filter(Product.category_id == id).first()
        if linked:
            return jsonify({'error': 'Category has linked products — reassign them first'}), 409

        db.delete(c)
        db.commit()
        return jsonify({'message': 'Category deleted'}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
