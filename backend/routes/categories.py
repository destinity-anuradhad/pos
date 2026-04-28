from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Category

categories_bp = Blueprint('categories', __name__)

def cat_to_dict(c):
    return {
        'id':                   c.id,
        'name':                 c.name,
        'color':                c.color,
        'sync_status':          c.sync_status or 'pending',
        'modified_by_terminal': c.modified_by_terminal,
        'updated_at':           c.updated_at.isoformat() if c.updated_at else None,
    }

@categories_bp.get('/')
def get_categories():
    db = db_session()
    try:
        return jsonify([cat_to_dict(c) for c in db.query(Category).all()])
    finally:
        db.close()

@categories_bp.post('/')
def create_category():
    db = db_session()
    try:
        data = request.get_json()
        terminal_code = request.headers.get('X-Terminal-Code') or data.get('terminal_code')
        incoming_sync = data.get('sync_status')
        cat = Category(
            name                 = data['name'],
            color                = data.get('color', '#094f70'),
            sync_status          = incoming_sync if incoming_sync else 'pending',
            modified_by_terminal = terminal_code,
        )
        db.add(cat); db.commit(); db.refresh(cat)
        return jsonify(cat_to_dict(cat)), 201
    finally:
        db.close()

@categories_bp.put('/<int:cat_id>')
def update_category(cat_id):
    db = db_session()
    try:
        cat = db.query(Category).filter(Category.id == cat_id).first()
        if not cat: return jsonify({'error': 'Category not found'}), 404
        data = request.get_json()
        terminal_code = request.headers.get('X-Terminal-Code') or data.get('terminal_code')
        if 'name'  in data: cat.name  = data['name']
        if 'color' in data: cat.color = data['color']
        if data.get('sync_status'):
            cat.sync_status = data['sync_status']
        else:
            cat.sync_status = 'pending'
            cat.modified_by_terminal = terminal_code
        db.commit(); db.refresh(cat)
        return jsonify(cat_to_dict(cat))
    finally:
        db.close()

@categories_bp.delete('/<int:cat_id>')
def delete_category(cat_id):
    db = db_session()
    try:
        cat = db.query(Category).filter(Category.id == cat_id).first()
        if not cat: return jsonify({'error': 'Category not found'}), 404
        db.delete(cat); db.commit()
        return jsonify({'message': 'Category deleted'})
    finally:
        db.close()
