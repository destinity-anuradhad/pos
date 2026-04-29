from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Outlet, Terminal
import uuid as uuid_lib
from datetime import datetime, timezone

outlets_bp = Blueprint('outlets', __name__)


def _outlet_to_dict(o):
    return {
        'id': o.id,
        'uuid': str(o.uuid),
        'code': o.code,
        'name': o.name,
        'address': o.address,
        'phone': o.phone,
        'timezone': o.timezone,
        'currency': o.currency,
        'vat_registration_no': o.vat_registration_no,
        'vat_rate': float(o.vat_rate) if o.vat_rate is not None else None,
        'invoice_prefix': o.invoice_prefix,
        'is_active': o.is_active,
        'created_at': o.created_at.isoformat() if o.created_at else None,
        'updated_at': o.updated_at.isoformat() if o.updated_at else None,
    }


@outlets_bp.route('/', methods=['GET'])
def list_outlets():
    db = get_db()
    try:
        outlets = db.query(Outlet).order_by(Outlet.name).all()
        return jsonify([_outlet_to_dict(o) for o in outlets])
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@outlets_bp.route('/', methods=['POST'])
def create_outlet():
    db = get_db()
    try:
        data = request.get_json(silent=True) or {}
        code = (data.get('code') or '').strip()
        name = (data.get('name') or '').strip()
        if not code:
            return jsonify({'error': 'code is required'}), 400
        if not name:
            return jsonify({'error': 'name is required'}), 400

        existing = db.query(Outlet).filter(Outlet.code == code).first()
        if existing:
            return jsonify({'error': f"Outlet with code '{code}' already exists"}), 409

        now = datetime.now(timezone.utc)
        outlet = Outlet(
            uuid=str(uuid_lib.uuid4()),
            code=code,
            name=name,
            address=data.get('address'),
            phone=data.get('phone'),
            timezone=data.get('timezone', 'Asia/Colombo'),
            currency=data.get('currency', 'LKR'),
            vat_registration_no=data.get('vat_registration_no'),
            vat_rate=data.get('vat_rate', 18.00),
            invoice_prefix=data.get('invoice_prefix', code),
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(outlet)
        db.commit()
        db.refresh(outlet)
        return jsonify(_outlet_to_dict(outlet)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@outlets_bp.route('/<int:id>', methods=['GET'])
def get_outlet(id):
    db = get_db()
    try:
        outlet = db.query(Outlet).filter(Outlet.id == id).first()
        if not outlet:
            return jsonify({'error': 'Outlet not found'}), 404
        return jsonify(_outlet_to_dict(outlet))
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@outlets_bp.route('/<int:id>', methods=['PUT'])
def update_outlet(id):
    db = get_db()
    try:
        outlet = db.query(Outlet).filter(Outlet.id == id).first()
        if not outlet:
            return jsonify({'error': 'Outlet not found'}), 404

        data = request.get_json(silent=True) or {}

        if 'code' in data:
            new_code = (data['code'] or '').strip()
            if new_code != outlet.code:
                clash = db.query(Outlet).filter(
                    Outlet.code == new_code, Outlet.id != id
                ).first()
                if clash:
                    return jsonify({'error': f"Outlet with code '{new_code}' already exists"}), 409
                outlet.code = new_code

        for field in ('name', 'address', 'phone', 'timezone', 'currency',
                      'vat_registration_no', 'vat_rate', 'invoice_prefix', 'is_active'):
            if field in data:
                setattr(outlet, field, data[field])

        outlet.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(outlet)
        return jsonify(_outlet_to_dict(outlet))
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@outlets_bp.route('/<int:id>', methods=['DELETE'])
def delete_outlet(id):
    db = get_db()
    try:
        outlet = db.query(Outlet).filter(Outlet.id == id).first()
        if not outlet:
            return jsonify({'error': 'Outlet not found'}), 404

        active_terminals = db.query(Terminal).filter(
            Terminal.outlet_id == id,
            Terminal.is_active == True,  # noqa: E712
        ).count()
        if active_terminals > 0:
            return jsonify({'error': 'Cannot deactivate outlet with active terminals'}), 409

        outlet.is_active = False
        outlet.updated_at = datetime.now(timezone.utc)
        db.commit()
        return jsonify({'message': 'Outlet deactivated', 'id': id})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
