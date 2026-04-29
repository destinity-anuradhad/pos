"""Terminal info / registration routes."""
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from models.models import TerminalInfo
from utils import db_session
from auth_utils import require_auth

terminals_bp = Blueprint('terminals', __name__)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _terminal_dict(t: TerminalInfo) -> dict:
    return {
        'terminal_uuid': t.terminal_uuid,
        'outlet_uuid': t.outlet_uuid,
        'terminal_code': t.terminal_code,
        'terminal_name': t.terminal_name,
        'outlet_code': t.outlet_code,
        'outlet_name': t.outlet_name,
        'currency': t.currency,
        'vat_rate': t.vat_rate,
        'timezone': t.timezone,
        'invoice_prefix': t.invoice_prefix,
        'registered_at': t.registered_at.isoformat() if t.registered_at else None,
        'last_master_sync_at': t.last_master_sync_at.isoformat() if t.last_master_sync_at else None,
        'last_tx_sync_at': t.last_tx_sync_at.isoformat() if t.last_tx_sync_at else None,
    }


@terminals_bp.route('/info', methods=['GET'])
def get_info():
    db = db_session()
    try:
        t = db.query(TerminalInfo).first()
        if not t:
            return jsonify({'error': 'Terminal not registered'}), 404
        return jsonify(_terminal_dict(t)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@terminals_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}

    required = ['terminal_code', 'terminal_name', 'outlet_code', 'outlet_name',
                'terminal_uuid', 'outlet_uuid']
    for field in required:
        if not data.get(field):
            return jsonify({'error': f'{field} is required'}), 400

    db = db_session()
    try:
        now = datetime.now(timezone.utc)
        t = db.query(TerminalInfo).first()

        if t:
            # Update existing
            t.terminal_uuid = data['terminal_uuid']
            t.outlet_uuid = data['outlet_uuid']
            t.terminal_code = data['terminal_code']
            t.terminal_name = data['terminal_name']
            t.outlet_code = data['outlet_code']
            t.outlet_name = data['outlet_name']
            if 'currency' in data:
                t.currency = data['currency']
            if 'vat_rate' in data:
                t.vat_rate = float(data['vat_rate'])
            if 'invoice_prefix' in data:
                t.invoice_prefix = data['invoice_prefix']
        else:
            t = TerminalInfo(
                terminal_uuid=data['terminal_uuid'],
                outlet_uuid=data['outlet_uuid'],
                terminal_code=data['terminal_code'],
                terminal_name=data['terminal_name'],
                outlet_code=data['outlet_code'],
                outlet_name=data['outlet_name'],
                currency=data.get('currency', 'LKR'),
                vat_rate=float(data.get('vat_rate', 0)),
                timezone=data.get('timezone', 'Asia/Colombo'),
                invoice_prefix=data.get('invoice_prefix', 'INV'),
                registered_at=now,
            )
            db.add(t)

        db.commit()
        db.refresh(t)
        return jsonify(_terminal_dict(t)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@terminals_bp.route('/info', methods=['DELETE'])
@require_auth(roles=['admin'])
def unregister():
    db = db_session()
    try:
        t = db.query(TerminalInfo).first()
        if not t:
            return jsonify({'error': 'Terminal not registered'}), 404

        db.delete(t)
        db.commit()
        return jsonify({'message': 'Terminal unregistered'}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
