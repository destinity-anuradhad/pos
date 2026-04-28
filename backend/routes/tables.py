from flask import Blueprint, request, jsonify
from utils import db_session
from models.models import RestaurantTable, TableStatus, TableStatusTransition
from sqlalchemy.sql import func

tables_bp = Blueprint('tables', __name__)


def table_to_dict(t):
    return {
        'id':          t.id,
        'name':        t.name,
        'capacity':    t.capacity,
        'status_id':   t.status_id,
        'status':      t.table_status.code  if t.table_status else 'available',
        'status_label': t.table_status.label if t.table_status else 'Available',
        'status_color': t.table_status.color if t.table_status else '#22c55e',
        'updated_at':  t.updated_at.isoformat() if t.updated_at else None,
        'synced_at':   t.synced_at.isoformat()  if t.synced_at  else None,
    }


def _get_allowed_transitions(db, status_id):
    """Return list of to_status dicts allowed from the given status_id."""
    transitions = (db.query(TableStatusTransition)
                   .filter(TableStatusTransition.from_status_id == status_id)
                   .all())
    return [
        {
            'to_status_id':    tr.to_status_id,
            'to_status_code':  tr.to_status.code,
            'to_status_label': tr.to_status.label,
            'to_status_color': tr.to_status.color,
            'trigger_type':    tr.trigger_type,
            'trigger_event':   tr.trigger_event,
        }
        for tr in transitions
    ]


@tables_bp.get('/')
def get_tables():
    db = db_session()
    try:
        tables = db.query(RestaurantTable).all()
        result = []
        for t in tables:
            d = table_to_dict(t)
            d['allowed_transitions'] = _get_allowed_transitions(db, t.status_id)
            result.append(d)
        return jsonify(result)
    finally:
        db.close()


@tables_bp.post('/')
def create_table():
    db = db_session()
    try:
        data = request.get_json()
        # Default to 'available' status
        status = db.query(TableStatus).filter(TableStatus.code == 'available').first()
        t = RestaurantTable(
            name=data['name'],
            capacity=data.get('capacity', 4),
            status_id=data.get('status_id', status.id if status else None),
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        d = table_to_dict(t)
        d['allowed_transitions'] = _get_allowed_transitions(db, t.status_id)
        return jsonify(d), 201
    finally:
        db.close()


@tables_bp.put('/<int:table_id>')
def update_table(table_id):
    db = db_session()
    try:
        t = db.query(RestaurantTable).filter(RestaurantTable.id == table_id).first()
        if not t:
            return jsonify({'error': 'Table not found'}), 404
        data = request.get_json()
        if 'name'     in data: t.name     = data['name']
        if 'capacity' in data: t.capacity = data['capacity']
        db.commit()
        db.refresh(t)
        d = table_to_dict(t)
        d['allowed_transitions'] = _get_allowed_transitions(db, t.status_id)
        return jsonify(d)
    finally:
        db.close()


@tables_bp.delete('/<int:table_id>')
def delete_table(table_id):
    db = db_session()
    try:
        t = db.query(RestaurantTable).filter(RestaurantTable.id == table_id).first()
        if not t:
            return jsonify({'error': 'Table not found'}), 404
        db.delete(t)
        db.commit()
        return jsonify({'message': 'Table deleted'})
    finally:
        db.close()


@tables_bp.patch('/<int:table_id>/status')
def update_table_status(table_id):
    """
    Transition a table to a new status.
    Validates that the transition is allowed.
    Query param: to_status_code=seated  (or to_status_id=3)
    """
    db = db_session()
    try:
        t = db.query(RestaurantTable).filter(RestaurantTable.id == table_id).first()
        if not t:
            return jsonify({'error': 'Table not found'}), 404

        # Resolve target status
        to_code = request.args.get('status') or request.args.get('to_status_code')
        to_id   = request.args.get('to_status_id')

        if to_code:
            target = db.query(TableStatus).filter(TableStatus.code == to_code).first()
        elif to_id:
            target = db.query(TableStatus).filter(TableStatus.id == int(to_id)).first()
        else:
            return jsonify({'error': 'to_status_code or to_status_id required'}), 400

        if not target:
            return jsonify({'error': 'Target status not found'}), 404

        # Validate transition
        allowed = db.query(TableStatusTransition).filter(
            TableStatusTransition.from_status_id == t.status_id,
            TableStatusTransition.to_status_id   == target.id,
        ).first()

        if not allowed:
            from_label = t.table_status.label if t.table_status else '?'
            return jsonify({
                'error': f'Transition from "{from_label}" to "{target.label}" is not allowed'
            }), 422

        t.status_id  = target.id
        t.updated_at = func.now()
        db.commit()
        db.refresh(t)
        d = table_to_dict(t)
        d['allowed_transitions'] = _get_allowed_transitions(db, t.status_id)
        return jsonify(d)
    finally:
        db.close()
