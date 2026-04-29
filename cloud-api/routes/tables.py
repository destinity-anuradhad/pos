import uuid as uuid_lib
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Table

tables_bp = Blueprint('tables', __name__)


def _table_to_dict(t):
    return {
        'id': t.id,
        'uuid': str(t.uuid),
        'outlet_id': t.outlet_id,
        'assigned_terminal_id': t.assigned_terminal_id,
        'name': t.name,
        'capacity': t.capacity,
        'section': t.section,
        'is_active': t.is_active,
        'created_at': t.created_at.isoformat() if t.created_at else None,
        'updated_at': t.updated_at.isoformat() if t.updated_at else None,
    }


@tables_bp.route('/', methods=['GET'])
def list_tables():
    db = get_db()
    try:
        outlet_id = request.args.get('outlet_id', type=int)
        if not outlet_id:
            return jsonify({'error': 'outlet_id is required'}), 400

        tables = (
            db.query(Table)
            .filter(Table.outlet_id == outlet_id, Table.is_active == True)  # noqa: E712
            .order_by(Table.section, Table.name)
            .all()
        )
        return jsonify([_table_to_dict(t) for t in tables])
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@tables_bp.route('/', methods=['POST'])
def create_table():
    db = get_db()
    try:
        data = request.get_json(silent=True) or {}
        outlet_id = data.get('outlet_id')
        name = (data.get('name') or '').strip()

        if not outlet_id:
            return jsonify({'error': 'outlet_id is required'}), 400
        if not name:
            return jsonify({'error': 'name is required'}), 400

        now = datetime.now(timezone.utc)
        table = Table(
            uuid=str(uuid_lib.uuid4()),
            outlet_id=outlet_id,
            name=name,
            capacity=data.get('capacity', 4),
            section=data.get('section'),
            assigned_terminal_id=data.get('assigned_terminal_id'),
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(table)
        db.commit()
        db.refresh(table)
        return jsonify(_table_to_dict(table)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@tables_bp.route('/<int:id>', methods=['PUT'])
def update_table(id):
    db = get_db()
    try:
        table = db.query(Table).filter(Table.id == id).first()
        if not table:
            return jsonify({'error': 'Table not found'}), 404

        data = request.get_json(silent=True) or {}
        for field in ('name', 'capacity', 'section', 'assigned_terminal_id', 'is_active'):
            if field in data:
                setattr(table, field, data[field])

        table.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(table)
        return jsonify(_table_to_dict(table))
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@tables_bp.route('/<int:id>', methods=['DELETE'])
def delete_table(id):
    db = get_db()
    try:
        table = db.query(Table).filter(Table.id == id).first()
        if not table:
            return jsonify({'error': 'Table not found'}), 404

        table.is_active = False
        table.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({'message': 'Table deactivated', 'id': id})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
