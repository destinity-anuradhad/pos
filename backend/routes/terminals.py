from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Terminal
from datetime import datetime

terminals_bp = Blueprint('terminals', __name__)


def terminal_to_dict(t):
    return {
        'id':            t.id,
        'uuid':          t.uuid,
        'terminal_code': t.terminal_code,
        'terminal_name': t.terminal_name,
        'platform':      t.platform,
        'is_active':     t.is_active,
        'registered_at': t.registered_at.isoformat() if t.registered_at else None,
        'last_seen_at':  t.last_seen_at.isoformat()  if t.last_seen_at  else None,
        'registered_by': t.registered_by,
    }


@terminals_bp.get('/')
def get_terminals():
    db = db_session()
    try:
        return jsonify([terminal_to_dict(t) for t in db.query(Terminal).all()])
    finally:
        db.close()


@terminals_bp.post('/')
def register_terminal():
    """Register a new terminal. Called on first launch."""
    db = db_session()
    try:
        data = request.get_json()
        uuid          = data.get('uuid')
        terminal_code = data.get('terminal_code', '').strip().upper()
        terminal_name = data.get('terminal_name', '').strip()
        platform      = data.get('platform', 'web')
        registered_by = data.get('registered_by')

        if not uuid or not terminal_code:
            return jsonify({'error': 'uuid and terminal_code are required'}), 400

        # Check for duplicate code
        existing = db.query(Terminal).filter(Terminal.terminal_code == terminal_code).first()
        if existing:
            return jsonify({'error': f'Terminal code "{terminal_code}" is already registered'}), 409

        # Check for duplicate UUID (re-registration)
        existing_uuid = db.query(Terminal).filter(Terminal.uuid == uuid).first()
        if existing_uuid:
            existing_uuid.last_seen_at = datetime.utcnow()
            db.commit()
            return jsonify(terminal_to_dict(existing_uuid))

        t = Terminal(
            uuid          = uuid,
            terminal_code = terminal_code,
            terminal_name = terminal_name or terminal_code,
            platform      = platform,
            registered_by = registered_by,
            last_seen_at  = datetime.utcnow(),
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        return jsonify(terminal_to_dict(t)), 201
    finally:
        db.close()


@terminals_bp.get('/<int:terminal_id>')
def get_terminal(terminal_id):
    db = db_session()
    try:
        t = db.query(Terminal).filter(Terminal.id == terminal_id).first()
        if not t:
            return jsonify({'error': 'Terminal not found'}), 404
        return jsonify(terminal_to_dict(t))
    finally:
        db.close()


@terminals_bp.get('/by-uuid/<uuid>')
def get_terminal_by_uuid(uuid):
    db = db_session()
    try:
        t = db.query(Terminal).filter(Terminal.uuid == uuid).first()
        if not t:
            return jsonify({'error': 'Terminal not found'}), 404
        t.last_seen_at = datetime.utcnow()
        db.commit()
        return jsonify(terminal_to_dict(t))
    finally:
        db.close()


@terminals_bp.put('/<int:terminal_id>')
def update_terminal(terminal_id):
    db = db_session()
    try:
        t = db.query(Terminal).filter(Terminal.id == terminal_id).first()
        if not t:
            return jsonify({'error': 'Terminal not found'}), 404
        data = request.get_json()
        if 'terminal_name' in data: t.terminal_name = data['terminal_name']
        if 'is_active'     in data: t.is_active     = data['is_active']
        db.commit()
        db.refresh(t)
        return jsonify(terminal_to_dict(t))
    finally:
        db.close()


@terminals_bp.delete('/<int:terminal_id>')
def delete_terminal(terminal_id):
    db = db_session()
    try:
        t = db.query(Terminal).filter(Terminal.id == terminal_id).first()
        if not t:
            return jsonify({'error': 'Terminal not found'}), 404
        db.delete(t)
        db.commit()
        return jsonify({'message': 'deleted'})
    finally:
        db.close()


@terminals_bp.patch('/<int:terminal_id>/heartbeat')
def terminal_heartbeat(terminal_id):
    """Update last_seen_at timestamp."""
    db = db_session()
    try:
        t = db.query(Terminal).filter(Terminal.id == terminal_id).first()
        if not t:
            return jsonify({'error': 'Terminal not found'}), 404
        t.last_seen_at = datetime.utcnow()
        db.commit()
        return jsonify({'message': 'ok', 'last_seen_at': t.last_seen_at.isoformat()})
    finally:
        db.close()
