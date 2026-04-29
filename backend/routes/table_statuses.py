"""Table status and transition routes."""
import uuid
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from models.models import TableStatus, TableStatusTransition
from utils import db_session
from auth_utils import require_auth

table_statuses_bp = Blueprint('table_statuses', __name__)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _status_dict(s: TableStatus, transitions=None) -> dict:
    d = {
        'id': s.id,
        'code': s.code,
        'label': s.label,
        'color': s.color,
        'sort_order': s.sort_order,
        'is_system': s.is_system,
        'is_active': s.is_active,
    }
    if transitions is not None:
        d['transitions'] = transitions
    return d


def _transition_dict(t: TableStatusTransition) -> dict:
    return {
        'id': t.id,
        'from_status_id': t.from_status_id,
        'to_status_id': t.to_status_id,
        'trigger_type': t.trigger_type,
        'trigger_event': t.trigger_event,
    }


@table_statuses_bp.route('/', methods=['GET'])
def list_statuses():
    db = db_session()
    try:
        statuses = (
            db.query(TableStatus)
            .order_by(TableStatus.sort_order)
            .all()
        )
        # Load all transitions indexed by from_status_id
        all_transitions = db.query(TableStatusTransition).all()
        trans_map: dict = {}
        for tr in all_transitions:
            trans_map.setdefault(tr.from_status_id, []).append(_transition_dict(tr))

        result = [_status_dict(s, trans_map.get(s.id, [])) for s in statuses]
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@table_statuses_bp.route('/', methods=['POST'])
@require_auth(roles=['manager', 'admin'])
def create_status():
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or '').strip()
    label = (data.get('label') or '').strip()
    if not code:
        return jsonify({'error': 'code is required'}), 400
    if not label:
        return jsonify({'error': 'label is required'}), 400

    db = db_session()
    try:
        existing = db.query(TableStatus).filter(TableStatus.code == code).first()
        if existing:
            return jsonify({'error': 'Status code already exists'}), 409

        s = TableStatus(
            code=code,
            label=label,
            color=data.get('color'),
            sort_order=data.get('sort_order', 0),
            is_system=False,
            is_active=True,
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        return jsonify(_status_dict(s)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@table_statuses_bp.route('/<int:id>', methods=['PUT'])
@require_auth(roles=['manager', 'admin'])
def update_status(id):
    data = request.get_json(silent=True) or {}
    db = db_session()
    try:
        s = db.query(TableStatus).filter(TableStatus.id == id).first()
        if not s:
            return jsonify({'error': 'Status not found'}), 404

        if 'label' in data:
            s.label = data['label']
        if 'color' in data:
            s.color = data['color']
        if 'sort_order' in data:
            s.sort_order = data['sort_order']
        # is_system statuses cannot have is_active or code changed
        if not s.is_system and 'is_active' in data:
            s.is_active = bool(data['is_active'])

        db.commit()
        db.refresh(s)
        return jsonify(_status_dict(s)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@table_statuses_bp.route('/<int:id>', methods=['DELETE'])
@require_auth(roles=['manager', 'admin'])
def delete_status(id):
    db = db_session()
    try:
        s = db.query(TableStatus).filter(TableStatus.id == id).first()
        if not s:
            return jsonify({'error': 'Status not found'}), 404
        if s.is_system:
            return jsonify({'error': 'Cannot delete system status'}), 409

        db.delete(s)
        db.commit()
        return jsonify({'message': 'Status deleted'}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@table_statuses_bp.route('/<int:id>/transitions', methods=['GET'])
def get_transitions(id):
    db = db_session()
    try:
        s = db.query(TableStatus).filter(TableStatus.id == id).first()
        if not s:
            return jsonify({'error': 'Status not found'}), 404

        transitions = (
            db.query(TableStatusTransition)
            .filter(TableStatusTransition.from_status_id == id)
            .all()
        )
        return jsonify([_transition_dict(t) for t in transitions]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@table_statuses_bp.route('/transitions', methods=['POST'])
@require_auth(roles=['manager', 'admin'])
def create_transition():
    data = request.get_json(silent=True) or {}
    from_status_id = data.get('from_status_id')
    to_status_id = data.get('to_status_id')
    trigger_type = data.get('trigger_type')

    if from_status_id is None:
        return jsonify({'error': 'from_status_id is required'}), 400
    if to_status_id is None:
        return jsonify({'error': 'to_status_id is required'}), 400
    if not trigger_type:
        return jsonify({'error': 'trigger_type is required'}), 400

    db = db_session()
    try:
        # Validate referenced statuses exist
        from_s = db.query(TableStatus).filter(TableStatus.id == from_status_id).first()
        to_s = db.query(TableStatus).filter(TableStatus.id == to_status_id).first()
        if not from_s:
            return jsonify({'error': 'from_status not found'}), 400
        if not to_s:
            return jsonify({'error': 'to_status not found'}), 400

        tr = TableStatusTransition(
            from_status_id=from_status_id,
            to_status_id=to_status_id,
            trigger_type=trigger_type,
            trigger_event=data.get('trigger_event'),
        )
        db.add(tr)
        db.commit()
        db.refresh(tr)
        return jsonify(_transition_dict(tr)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
