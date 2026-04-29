"""Settings and sync-settings routes."""
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from models.models import Setting, SyncSettings
from utils import db_session, as_iso
from auth_utils import require_auth

settings_bp = Blueprint('settings', __name__)

_MASKED = '***'


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _setting_dict(s: Setting, mask_secret: bool = True) -> dict:
    return {
        'id': s.id,
        'key': s.key,
        'value': _MASKED if (s.is_secret and mask_secret) else s.value,
        'is_secret': s.is_secret,
        'updated_at': as_iso(s.updated_at),
    }


def _sync_settings_dict(s: SyncSettings) -> dict:
    return {
        'id': s.id,
        'sync_interval_minutes': s.sync_interval_minutes,
        'auto_sync_enabled': s.auto_sync_enabled,
        'cloud_base_url': s.cloud_base_url,
        'last_master_sync_at': as_iso(s.last_master_sync_at),
        'last_tx_sync_at': as_iso(s.last_tx_sync_at),
    }


@settings_bp.route('/', methods=['GET'])
def list_settings():
    db = db_session()
    try:
        settings = db.query(Setting).all()
        result = {}
        for s in settings:
            result[s.key] = _MASKED if s.is_secret else s.value
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@settings_bp.route('/<key>', methods=['GET'])
def get_setting(key):
    db = db_session()
    try:
        s = db.query(Setting).filter(Setting.key == key).first()
        if not s:
            return jsonify({'error': 'Setting not found'}), 404
        return jsonify(_setting_dict(s)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@settings_bp.route('/<key>', methods=['PUT'])
@require_auth(roles=['manager', 'admin'])
def upsert_setting(key):
    data = request.get_json(silent=True) or {}
    if 'value' not in data:
        return jsonify({'error': 'value is required'}), 400

    db = db_session()
    try:
        now = datetime.now(timezone.utc)
        s = db.query(Setting).filter(Setting.key == key).first()
        if s:
            s.value = str(data['value'])
            if 'is_secret' in data:
                s.is_secret = bool(data['is_secret'])
            s.updated_at = now
        else:
            s = Setting(
                key=key,
                value=str(data['value']),
                is_secret=bool(data.get('is_secret', False)),
                updated_at=now,
            )
            db.add(s)

        db.commit()
        db.refresh(s)
        return jsonify(_setting_dict(s)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@settings_bp.route('/<key>', methods=['DELETE'])
@require_auth(roles=['admin'])
def delete_setting(key):
    db = db_session()
    try:
        s = db.query(Setting).filter(Setting.key == key).first()
        if not s:
            return jsonify({'error': 'Setting not found'}), 404

        db.delete(s)
        db.commit()
        return jsonify({'message': 'Setting deleted'}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@settings_bp.route('/sync', methods=['GET'])
def get_sync_settings():
    db = db_session()
    try:
        s = db.query(SyncSettings).first()
        if not s:
            return jsonify({'error': 'Sync settings not configured'}), 404
        return jsonify(_sync_settings_dict(s)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@settings_bp.route('/sync', methods=['PUT'])
@require_auth(roles=['manager', 'admin'])
def update_sync_settings():
    data = request.get_json(silent=True) or {}
    db = db_session()
    try:
        s = db.query(SyncSettings).first()
        if not s:
            s = SyncSettings()
            db.add(s)

        if 'sync_interval_minutes' in data:
            s.sync_interval_minutes = int(data['sync_interval_minutes'])
        if 'auto_sync_enabled' in data:
            s.auto_sync_enabled = bool(data['auto_sync_enabled'])
        if 'cloud_base_url' in data:
            s.cloud_base_url = data['cloud_base_url']

        db.commit()
        db.refresh(s)
        return jsonify(_sync_settings_dict(s)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
