import hashlib
import uuid as uuid_lib
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Terminal, Outlet

terminals_bp = Blueprint('terminals', __name__)


def _terminal_to_dict(t):
    return {
        'id': t.id,
        'uuid': str(t.uuid),
        'outlet_id': t.outlet_id,
        'terminal_code': t.terminal_code,
        'terminal_name': t.terminal_name,
        'device_uuid': str(t.device_uuid) if t.device_uuid else None,
        'platform': t.platform,
        'last_seen_at': t.last_seen_at.isoformat() if t.last_seen_at else None,
        'last_sync_at': t.last_sync_at.isoformat() if t.last_sync_at else None,
        'is_active': t.is_active,
        'registered_at': t.registered_at.isoformat() if t.registered_at else None,
    }


@terminals_bp.route('/', methods=['GET'])
def list_terminals():
    db = get_db()
    try:
        outlet_id = request.args.get('outlet_id', type=int)
        q = db.query(Terminal)
        if outlet_id:
            q = q.filter(Terminal.outlet_id == outlet_id)
        terminals = q.order_by(Terminal.terminal_code).all()
        return jsonify([_terminal_to_dict(t) for t in terminals])
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@terminals_bp.route('/register', methods=['POST'])
def register_terminal():
    db = get_db()
    try:
        data = request.get_json(silent=True) or {}

        outlet_id = data.get('outlet_id')
        terminal_code = (data.get('terminal_code') or '').strip()
        terminal_name = (data.get('terminal_name') or '').strip()
        device_uuid = (data.get('device_uuid') or '').strip() or str(uuid_lib.uuid4())
        platform = data.get('platform', 'web')
        api_key_plain = data.get('api_key')

        if not outlet_id:
            return jsonify({'error': 'outlet_id is required'}), 400
        if not terminal_code:
            return jsonify({'error': 'terminal_code is required'}), 400

        outlet = db.query(Outlet).filter(Outlet.id == outlet_id).first()
        if not outlet:
            return jsonify({'error': 'Outlet not found'}), 404

        # If no api_key supplied, generate one
        if not api_key_plain:
            api_key_plain = str(uuid_lib.uuid4())

        api_key_hash = hashlib.sha256(api_key_plain.encode()).hexdigest()

        now = datetime.now(timezone.utc)
        terminal = Terminal(
            uuid=str(uuid_lib.uuid4()),
            outlet_id=outlet_id,
            terminal_code=terminal_code,
            terminal_name=terminal_name,
            device_uuid=device_uuid,
            platform=platform,
            api_key_hash=api_key_hash,
            is_active=True,
            registered_at=now,
            updated_at=now,
        )
        db.add(terminal)
        db.commit()
        db.refresh(terminal)
        return jsonify({
            'terminal': _terminal_to_dict(terminal),
            'api_key': api_key_plain,
        }), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@terminals_bp.route('/<int:id>', methods=['GET'])
def get_terminal(id):
    db = get_db()
    try:
        terminal = db.query(Terminal).filter(Terminal.id == id).first()
        if not terminal:
            return jsonify({'error': 'Terminal not found'}), 404
        return jsonify(_terminal_to_dict(terminal))
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@terminals_bp.route('/<int:id>', methods=['PUT'])
def update_terminal(id):
    db = get_db()
    try:
        terminal = db.query(Terminal).filter(Terminal.id == id).first()
        if not terminal:
            return jsonify({'error': 'Terminal not found'}), 404

        data = request.get_json(silent=True) or {}
        if 'terminal_name' in data:
            terminal.terminal_name = data['terminal_name']
        if 'is_active' in data:
            terminal.is_active = bool(data['is_active'])

        terminal.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(terminal)
        return jsonify(_terminal_to_dict(terminal))
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@terminals_bp.route('/<int:id>/heartbeat', methods=['POST'])
def heartbeat(id):
    db = get_db()
    try:
        terminal = db.query(Terminal).filter(Terminal.id == id).first()
        if not terminal:
            return jsonify({'error': 'Terminal not found'}), 404

        now = datetime.now(timezone.utc)
        terminal.last_seen_at = now
        terminal.updated_at = now
        db.commit()
        return jsonify({
            'id': terminal.id,
            'terminal_code': terminal.terminal_code,
            'last_seen_at': terminal.last_seen_at.isoformat(),
        })
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
