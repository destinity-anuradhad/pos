from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Terminal, Outlet

terminals_bp = Blueprint('terminals', __name__)


def _terminal_to_dict(t):
    return {
        'id': t.id,
        'outlet_id': t.outlet_id,
        'outlet_code': t.outlet.code if t.outlet else None,
        'outlet_name': t.outlet.name if t.outlet else None,
        'terminal_code': t.terminal_code,
        'terminal_name': t.terminal_name,
        'uuid': t.uuid,
        'last_sync_at': t.last_sync_at.isoformat() if t.last_sync_at else None,
        'is_active': t.is_active,
        'created_at': t.created_at.isoformat() if t.created_at else None,
    }


@terminals_bp.get('/')
def list_terminals():
    db = get_db()
    try:
        active_only = request.args.get('active_only', 'false').lower() == 'true'
        q = db.query(Terminal)
        if active_only:
            q = q.filter(Terminal.is_active == True)  # noqa: E712
        terminals = q.order_by(Terminal.terminal_code).all()
        return jsonify([_terminal_to_dict(t) for t in terminals]), 200
    finally:
        db.close()


@terminals_bp.post('/register')
def register_terminal():
    """
    Register a new terminal. Idempotent — if terminal_code already exists,
    returns the existing record.

    Payload:
    {
      "terminal_code": "T-001",
      "terminal_name": "Counter 1",
      "outlet_code": "MAIN-01",
      "uuid": "550e8400-e29b-41d4-a716-446655440000"
    }
    """
    data = request.get_json(silent=True) or {}
    terminal_code = data.get('terminal_code', '').strip()
    if not terminal_code:
        return jsonify({'error': 'terminal_code is required'}), 400

    db = get_db()
    try:
        # Idempotent — return existing if already registered
        existing = db.query(Terminal).filter(
            Terminal.terminal_code == terminal_code
        ).first()
        if existing:
            return jsonify(_terminal_to_dict(existing)), 200

        # Resolve outlet by outlet_code
        outlet_id = None
        outlet_code = data.get('outlet_code', '').strip()
        if outlet_code:
            outlet = db.query(Outlet).filter(Outlet.code == outlet_code).first()
            if outlet:
                outlet_id = outlet.id

        terminal = Terminal(
            terminal_code=terminal_code,
            terminal_name=data.get('terminal_name', ''),
            outlet_id=outlet_id,
            uuid=data.get('uuid'),
            is_active=True,
        )
        db.add(terminal)
        db.commit()
        db.refresh(terminal)
        return jsonify(_terminal_to_dict(terminal)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@terminals_bp.get('/<int:terminal_id>')
def get_terminal(terminal_id):
    db = get_db()
    try:
        terminal = db.query(Terminal).filter(Terminal.id == terminal_id).first()
        if not terminal:
            return jsonify({'error': 'Terminal not found'}), 404
        return jsonify(_terminal_to_dict(terminal)), 200
    finally:
        db.close()


@terminals_bp.patch('/<int:terminal_id>/heartbeat')
def heartbeat(terminal_id):
    """Update last_sync_at to now."""
    db = get_db()
    try:
        terminal = db.query(Terminal).filter(Terminal.id == terminal_id).first()
        if not terminal:
            return jsonify({'error': 'Terminal not found'}), 404
        terminal.last_sync_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({
            'id': terminal.id,
            'terminal_code': terminal.terminal_code,
            'last_sync_at': terminal.last_sync_at.isoformat(),
        }), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
