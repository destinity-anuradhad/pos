"""Cloud customers routes."""
import uuid as _uuid
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from database import get_db
from models.models import Customer

customers_bp = Blueprint('customers', __name__)

def _now(): return datetime.now(timezone.utc)

def _c(c: Customer) -> dict:
    return {
        'id':                   c.id,
        'uuid':                 c.uuid,
        'phone':                c.phone,
        'name':                 c.name,
        'email':                c.email,
        'loyalty_card_no':      c.loyalty_card_no,
        'loyalty_points':       c.loyalty_points,
        'total_spent':          float(c.total_spent) if c.total_spent is not None else 0,
        'visit_count':          c.visit_count,
        'notes':                c.notes,
        'is_active':            c.is_active,
        'created_at':           c.created_at.isoformat() if c.created_at else None,
        'updated_at':           c.updated_at.isoformat() if c.updated_at else None,
    }

@customers_bp.get('/')
def list_customers():
    q_str = request.args.get('q', '').strip()
    skip  = max(0, request.args.get('skip', 0, type=int))
    limit = min(max(1, request.args.get('limit', 50, type=int)), 500)
    db = get_db()
    try:
        q = db.query(Customer).filter(Customer.is_active == True)
        if q_str:
            like = f'%{q_str}%'
            q = q.filter((Customer.phone.ilike(like)) | (Customer.name.ilike(like)))
        total = q.count()
        customers = q.offset(skip).limit(limit).all()
        return jsonify({'total': total, 'customers': [_c(c) for c in customers]})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()

@customers_bp.post('/')
def create_or_find():
    data  = request.get_json(silent=True) or {}
    phone = (data.get('phone') or '').strip() or None
    db = get_db()
    try:
        if phone:
            existing = db.query(Customer).filter(Customer.phone == phone).first()
            if existing:
                return jsonify(_c(existing)), 200
        c = Customer(
            uuid=str(_uuid.uuid4()),
            phone=phone,
            name=(data.get('name') or '').strip() or None,
            email=(data.get('email') or '').strip() or None,
            notes=(data.get('notes') or '').strip() or None,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        return jsonify(_c(c)), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()

@customers_bp.get('/<int:customer_id>')
def get_customer(customer_id):
    db = get_db()
    try:
        c = db.query(Customer).filter(Customer.id == customer_id).first()
        if not c:
            return jsonify({'error': 'Customer not found'}), 404
        return jsonify(_c(c))
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()

@customers_bp.put('/<int:customer_id>')
def update_customer(customer_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    try:
        c = db.query(Customer).filter(Customer.id == customer_id).first()
        if not c:
            return jsonify({'error': 'Customer not found'}), 404
        for field in ('name', 'email', 'phone', 'notes', 'loyalty_card_no'):
            if field in data:
                setattr(c, field, (data[field] or '').strip() or None)
        db.commit()
        db.refresh(c)
        return jsonify(_c(c))
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()
