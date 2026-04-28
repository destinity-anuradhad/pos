from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import TableStatus, TableStatusTransition

table_statuses_bp = Blueprint('table_statuses', __name__)


def status_to_dict(s, include_transitions=False):
    d = {
        'id':         s.id,
        'code':       s.code,
        'label':      s.label,
        'color':      s.color,
        'sort_order': s.sort_order,
        'is_system':  s.is_system,
        'is_active':  s.is_active,
    }
    if include_transitions:
        d['transitions_from'] = [
            {
                'to_status_id':    tr.to_status_id,
                'to_status_code':  tr.to_status.code,
                'to_status_label': tr.to_status.label,
                'trigger_type':    tr.trigger_type,
                'trigger_event':   tr.trigger_event,
            }
            for tr in s.transitions_from
        ]
    return d


@table_statuses_bp.get('/')
def get_statuses():
    db = db_session()
    try:
        statuses = (db.query(TableStatus)
                    .filter(TableStatus.is_active == True)
                    .order_by(TableStatus.sort_order)
                    .all())
        return jsonify([status_to_dict(s, include_transitions=True) for s in statuses])
    finally:
        db.close()


@table_statuses_bp.post('/')
def create_status():
    """Admin: add a custom status (e.g. Reserved)."""
    db = db_session()
    try:
        data = request.get_json()
        code = data.get('code', '').strip().lower().replace(' ', '_')
        if not code:
            return jsonify({'error': 'code is required'}), 400

        existing = db.query(TableStatus).filter(TableStatus.code == code).first()
        if existing:
            return jsonify({'error': f'Status code "{code}" already exists'}), 409

        max_order = db.query(TableStatus).count()
        s = TableStatus(
            code       = code,
            label      = data.get('label', code.title()),
            color      = data.get('color', '#64748b'),
            sort_order = data.get('sort_order', max_order + 1),
            is_system  = False,
            is_active  = True,
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        return jsonify(status_to_dict(s)), 201
    finally:
        db.close()


@table_statuses_bp.put('/<int:status_id>')
def update_status(status_id):
    db = db_session()
    try:
        s = db.query(TableStatus).filter(TableStatus.id == status_id).first()
        if not s:
            return jsonify({'error': 'Status not found'}), 404
        data = request.get_json()
        if 'label'      in data: s.label      = data['label']
        if 'color'      in data: s.color      = data['color']
        if 'sort_order' in data: s.sort_order = data['sort_order']
        db.commit()
        db.refresh(s)
        return jsonify(status_to_dict(s))
    finally:
        db.close()


@table_statuses_bp.delete('/<int:status_id>')
def delete_status(status_id):
    db = db_session()
    try:
        s = db.query(TableStatus).filter(TableStatus.id == status_id).first()
        if not s:
            return jsonify({'error': 'Status not found'}), 404
        if s.is_system:
            return jsonify({'error': 'System statuses cannot be deleted'}), 403
        s.is_active = False
        db.commit()
        return jsonify({'message': 'Status deactivated'})
    finally:
        db.close()


# ── Transitions ───────────────────────────────────────────────────────────────

@table_statuses_bp.get('/transitions')
def get_transitions():
    db = db_session()
    try:
        transitions = db.query(TableStatusTransition).all()
        return jsonify([
            {
                'id':              tr.id,
                'from_status_id':  tr.from_status_id,
                'from_status_code': tr.from_status.code,
                'to_status_id':    tr.to_status_id,
                'to_status_code':  tr.to_status.code,
                'trigger_type':    tr.trigger_type,
                'trigger_event':   tr.trigger_event,
            }
            for tr in transitions
        ])
    finally:
        db.close()


@table_statuses_bp.post('/transitions')
def add_transition():
    """Admin: add a new allowed transition."""
    db = db_session()
    try:
        data = request.get_json()
        tr = TableStatusTransition(
            from_status_id = data['from_status_id'],
            to_status_id   = data['to_status_id'],
            trigger_type   = data.get('trigger_type', 'manual'),
            trigger_event  = data.get('trigger_event', 'staff_action'),
        )
        db.add(tr)
        db.commit()
        db.refresh(tr)
        return jsonify({'id': tr.id, 'message': 'Transition added'}), 201
    finally:
        db.close()


@table_statuses_bp.delete('/transitions/<int:transition_id>')
def delete_transition(transition_id):
    db = db_session()
    try:
        tr = db.query(TableStatusTransition).filter(TableStatusTransition.id == transition_id).first()
        if not tr:
            return jsonify({'error': 'Transition not found'}), 404
        db.delete(tr)
        db.commit()
        return jsonify({'message': 'Transition removed'})
    finally:
        db.close()
