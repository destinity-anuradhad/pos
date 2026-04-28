from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Setting, SyncSettings
from datetime import datetime

settings_bp = Blueprint('settings', __name__)


@settings_bp.get('/')
def get_settings():
    db = db_session()
    try:
        return jsonify({s.key: s.value for s in db.query(Setting).all()})
    finally:
        db.close()


@settings_bp.put('/<key>')
def update_setting(key):
    db = db_session()
    try:
        data = request.get_json()
        s = db.query(Setting).filter(Setting.key == key).first()
        if s:
            s.value = data['value']
        else:
            db.add(Setting(key=key, value=data['value']))
        db.commit()
        return jsonify({'key': key, 'value': data['value']})
    finally:
        db.close()


# ── Sync settings ────────────────────────────────────────────────────────────

@settings_bp.get('/sync')
def get_sync_settings():
    db = db_session()
    try:
        ss = db.query(SyncSettings).first()
        if not ss:
            ss = SyncSettings(sync_interval_minutes=10, auto_sync_enabled=True)
            db.add(ss)
            db.commit()
            db.refresh(ss)
        return jsonify({
            'id':                       ss.id,
            'sync_interval_minutes':    ss.sync_interval_minutes,
            'auto_sync_enabled':        ss.auto_sync_enabled,
            'last_master_sync_at':      ss.last_master_sync_at.isoformat()      if ss.last_master_sync_at      else None,
            'last_transaction_sync_at': ss.last_transaction_sync_at.isoformat() if ss.last_transaction_sync_at else None,
        })
    finally:
        db.close()


@settings_bp.put('/sync')
def update_sync_settings():
    db = db_session()
    try:
        data = request.get_json()
        ss   = db.query(SyncSettings).first()
        if not ss:
            ss = SyncSettings()
            db.add(ss)
        if 'sync_interval_minutes' in data:
            ss.sync_interval_minutes = int(data['sync_interval_minutes'])
        if 'auto_sync_enabled' in data:
            ss.auto_sync_enabled = bool(data['auto_sync_enabled'])
        db.commit()
        db.refresh(ss)
        return jsonify({
            'sync_interval_minutes': ss.sync_interval_minutes,
            'auto_sync_enabled':     ss.auto_sync_enabled,
        })
    finally:
        db.close()


@settings_bp.patch('/sync/timestamp')
def update_sync_timestamp():
    """Update last sync timestamps after a successful sync."""
    db = db_session()
    try:
        data = request.get_json()
        ss   = db.query(SyncSettings).first()
        if ss:
            if data.get('type') == 'master':
                ss.last_master_sync_at = datetime.utcnow()
            elif data.get('type') == 'transactions':
                ss.last_transaction_sync_at = datetime.utcnow()
            db.commit()
        return jsonify({'message': 'Timestamp updated'})
    finally:
        db.close()
