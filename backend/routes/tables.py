"""Restaurant table routes."""
import uuid
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from models.models import RestaurantTable, TableStatus
from utils import db_session, as_iso
from auth_utils import require_auth

tables_bp = Blueprint('tables', __name__)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _table_dict(t: RestaurantTable, status: TableStatus = None) -> dict:
    return {
        'id': t.id,
        'uuid': t.uuid,
        'name': t.name,
        'capacity': t.capacity,
        'section': t.section,
        'status_id': t.status_id,
        'status_code': status.code if status else None,
        'status_label': status.label if status else None,
        'status_color': status.color if status else None,
        'is_active': t.is_active,
        'updated_at': as_iso(t.updated_at),
        'synced_at': as_iso(t.synced_at),
    }


@tables_bp.route('/', methods=['GET'])
def list_tables():
    db = db_session()
    try:
        tables = (
            db.query(RestaurantTable)
            .filter(RestaurantTable.is_active == True)
            .all()
        )
        # Collect status ids
        status_ids = {t.status_id for t in tables if t.status_id}
        statuses = {}
        if status_ids:
            for st in db.query(TableStatus).filter(TableStatus.id.in_(status_ids)).all():
                statuses[st.id] = st

        return jsonify([_table_dict(t, statuses.get(t.status_id)) for t in tables]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@tables_bp.route('/', methods=['POST'])
@require_auth(roles=['manager', 'admin'])
def create_table():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    db = db_session()
    try:
        # Find the default 'available' status
        available_status = (
            db.query(TableStatus)
            .filter(TableStatus.code == 'available')
            .first()
        )
        status_id = available_status.id if available_status else None

        t = RestaurantTable(
            uuid=str(uuid.uuid4()),
            name=name,
            capacity=data.get('capacity'),
            section=data.get('section'),
            status_id=status_id,
            is_active=True,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(t)
        db.commit()
        db.refresh(t)

        status = db.query(TableStatus).filter(TableStatus.id == t.status_id).first() if t.status_id else None
        return jsonify(_table_dict(t, status)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@tables_bp.route('/<int:id>', methods=['PUT'])
@require_auth(roles=['manager', 'admin'])
def update_table(id):
    data = request.get_json(silent=True) or {}
    db = db_session()
    try:
        t = db.query(RestaurantTable).filter(RestaurantTable.id == id).first()
        if not t:
            return jsonify({'error': 'Table not found'}), 404

        if 'name' in data:
            t.name = data['name']
        if 'capacity' in data:
            t.capacity = data['capacity']
        if 'section' in data:
            t.section = data['section']
        if 'status_id' in data:
            t.status_id = data['status_id']
        if 'is_active' in data:
            t.is_active = bool(data['is_active'])

        t.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(t)

        status = db.query(TableStatus).filter(TableStatus.id == t.status_id).first() if t.status_id else None
        return jsonify(_table_dict(t, status)), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@tables_bp.route('/<int:id>', methods=['DELETE'])
@require_auth(roles=['manager', 'admin'])
def delete_table(id):
    db = db_session()
    try:
        t = db.query(RestaurantTable).filter(RestaurantTable.id == id).first()
        if not t:
            return jsonify({'error': 'Table not found'}), 404

        t.is_active = False
        t.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({'message': 'Table deactivated'}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
