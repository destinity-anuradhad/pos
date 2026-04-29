import uuid as uuid_lib
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Category, OutletCategory

categories_bp = Blueprint('categories', __name__)


def _category_to_dict(c, outlet_override=None):
    d = {
        'id': c.id,
        'uuid': str(c.uuid),
        'name': c.name,
        'color': c.color,
        'icon': c.icon,
        'sort_order': c.sort_order,
        'is_active': c.is_active,
        'created_at': c.created_at.isoformat() if c.created_at else None,
        'updated_at': c.updated_at.isoformat() if c.updated_at else None,
    }
    if outlet_override is not None:
        d['is_visible'] = outlet_override.is_visible
        d['sort_order_override'] = outlet_override.sort_order_override
        d['effective_sort_order'] = (
            outlet_override.sort_order_override
            if outlet_override.sort_order_override is not None
            else c.sort_order
        )
    return d


def _outlet_category_to_dict(oc):
    return {
        'id': oc.id,
        'uuid': str(oc.uuid),
        'outlet_id': oc.outlet_id,
        'category_id': oc.category_id,
        'is_visible': oc.is_visible,
        'sort_order_override': oc.sort_order_override,
        'updated_at': oc.updated_at.isoformat() if oc.updated_at else None,
    }


@categories_bp.route('/', methods=['GET'])
def list_categories():
    db = get_db()
    try:
        outlet_id = request.args.get('outlet_id', type=int)
        categories = (
            db.query(Category)
            .filter(Category.is_active == True)  # noqa: E712
            .order_by(Category.sort_order, Category.name)
            .all()
        )

        result = []
        for cat in categories:
            override = None
            if outlet_id:
                override = db.query(OutletCategory).filter(
                    OutletCategory.outlet_id == outlet_id,
                    OutletCategory.category_id == cat.id,
                ).first()
                # Skip if outlet has explicitly hidden this category
                if override and not override.is_visible:
                    continue
            result.append(_category_to_dict(cat, override))

        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@categories_bp.route('/', methods=['POST'])
def create_category():
    db = get_db()
    try:
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'error': 'name is required'}), 400

        now = datetime.now(timezone.utc)
        cat = Category(
            uuid=str(uuid_lib.uuid4()),
            name=name,
            color=data.get('color', '#6b7280'),
            icon=data.get('icon'),
            sort_order=data.get('sort_order', 0),
            is_active=True,
            created_at=now,
            updated_at=now,
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


@categories_bp.route('/<int:id>', methods=['PUT'])
def update_category(id):
    db = get_db()
    try:
        cat = db.query(Category).filter(Category.id == id).first()
        if not cat:
            return jsonify({'error': 'Category not found'}), 404

        data = request.get_json(silent=True) or {}
        for field in ('name', 'color', 'icon', 'sort_order', 'is_active'):
            if field in data:
                setattr(cat, field, data[field])

        cat.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(cat)
        return jsonify(_category_to_dict(cat))
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@categories_bp.route('/<int:id>', methods=['DELETE'])
def delete_category(id):
    db = get_db()
    try:
        cat = db.query(Category).filter(Category.id == id).first()
        if not cat:
            return jsonify({'error': 'Category not found'}), 404

        cat.is_active = False
        cat.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({'message': 'Category deactivated', 'id': id})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@categories_bp.route('/<int:id>/outlet-overrides', methods=['GET'])
def get_outlet_overrides(id):
    db = get_db()
    try:
        cat = db.query(Category).filter(Category.id == id).first()
        if not cat:
            return jsonify({'error': 'Category not found'}), 404

        overrides = (
            db.query(OutletCategory)
            .filter(OutletCategory.category_id == id)
            .all()
        )
        return jsonify([_outlet_category_to_dict(oc) for oc in overrides])
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@categories_bp.route('/<int:id>/outlet-overrides', methods=['POST'])
def upsert_outlet_override(id):
    db = get_db()
    try:
        cat = db.query(Category).filter(Category.id == id).first()
        if not cat:
            return jsonify({'error': 'Category not found'}), 404

        data = request.get_json(silent=True) or {}
        outlet_id = data.get('outlet_id')
        if not outlet_id:
            return jsonify({'error': 'outlet_id is required'}), 400

        oc = db.query(OutletCategory).filter(
            OutletCategory.outlet_id == outlet_id,
            OutletCategory.category_id == id,
        ).first()

        now = datetime.now(timezone.utc)
        if oc:
            if 'is_visible' in data:
                oc.is_visible = data['is_visible']
            if 'sort_order_override' in data:
                oc.sort_order_override = data['sort_order_override']
            oc.updated_at = now
            status = 200
        else:
            oc = OutletCategory(
                uuid=str(uuid_lib.uuid4()),
                outlet_id=outlet_id,
                category_id=id,
                is_visible=data.get('is_visible', True),
                sort_order_override=data.get('sort_order_override'),
                updated_at=now,
            )
            db.add(oc)
            status = 201

        db.commit()
        db.refresh(oc)
        return jsonify(_outlet_category_to_dict(oc)), status
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
