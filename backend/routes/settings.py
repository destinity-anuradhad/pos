from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import Setting

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
        data  = request.get_json()
        s = db.query(Setting).filter(Setting.key == key).first()
        if s:
            s.value = data['value']
        else:
            db.add(Setting(key=key, value=data['value']))
        db.commit()
        return jsonify({'key': key, 'value': data['value']})
    finally:
        db.close()
