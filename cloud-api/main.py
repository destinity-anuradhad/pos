import os
from flask import Flask, jsonify
from flask_cors import CORS
from database import init_db
from routes.sync import sync_bp
from routes.products import products_bp
from routes.categories import categories_bp
from routes.terminals import terminals_bp
from routes.outlets import outlets_bp
from routes.reports import reports_bp

# Initialise DB and seed default data before the first request
init_db()

app = Flask(__name__)
CORS(app)

app.register_blueprint(sync_bp,       url_prefix='/api/sync')
app.register_blueprint(products_bp,   url_prefix='/api/products')
app.register_blueprint(categories_bp, url_prefix='/api/categories')
app.register_blueprint(terminals_bp,  url_prefix='/api/terminals')
app.register_blueprint(outlets_bp,    url_prefix='/api/outlets')
app.register_blueprint(reports_bp,    url_prefix='/api/reports')


@app.get('/')
def root():
    return jsonify({
        'message': 'Destinity Inspire POS — Cloud HQ API',
        'version': '1.0.0',
        'endpoints': {
            'sync_push':       'POST /api/sync/push',
            'sync_pull':       'GET  /api/sync/pull',
            'products':        'GET  /api/products/',
            'categories':      'GET  /api/categories/',
            'terminals':       'GET  /api/terminals/',
            'outlets':         'GET  /api/outlets/',
            'reports_sales':   'GET  /api/reports/sales',
            'reports_orders':  'GET  /api/reports/orders',
            'reports_outlets': 'GET  /api/reports/outlets',
            'health':          'GET  /health',
        },
    })


@app.get('/health')
def health():
    return jsonify({'status': 'ok'})


@app.post('/api/admin/reset-and-seed')
def reset_and_seed():
    """
    Wipe all master + transaction data and reseed with fresh restaurant menu.
    Keeps outlets and terminals intact.
    Protected by a simple secret header: X-Reset-Key: destinity-reset-2024
    """
    from flask import request
    if request.headers.get('X-Reset-Key') != 'destinity-reset-2024':
        return jsonify({'error': 'Unauthorized'}), 403

    from database import get_db
    from models.models import (
        Order, OrderItem, Product, Category, RestaurantTable, SyncLog
    )
    from sqlalchemy import text

    db = get_db()
    try:
        # Wipe in FK-safe order
        db.execute(text('DELETE FROM sync_logs'))
        db.execute(text('DELETE FROM order_items'))
        db.execute(text('DELETE FROM orders'))
        db.execute(text('DELETE FROM products'))
        db.execute(text('DELETE FROM categories'))
        db.execute(text('DELETE FROM tables'))
        db.commit()

        # Reseed categories
        cat_names = [
            ('Main Course', '#ef4444'),
            ('Salads',      '#22c55e'),
            ('Starters',    '#f59e0b'),
            ('Desserts',    '#ec4899'),
            ('Beverages',   '#06b6d4'),
        ]
        cats = {}
        for name, color in cat_names:
            c = Category(name=name, color=color)
            db.add(c)
            db.flush()
            cats[name] = c.id

        # Reseed products (full restaurant menu)
        menu = [
            ('Grilled Chicken', 'Main Course', 1800, 6.00, 'R1001', 50),
            ('Fried Rice',      'Main Course', 1200, 4.00, 'R1002', 50),
            ('Pasta Carbonara', 'Main Course', 1500, 5.00, 'R1003', 30),
            ('Beef Burger',     'Main Course', 1650, 5.50, 'R1004', 40),
            ('Caesar Salad',    'Salads',       900, 3.00, 'R1005', 30),
            ('Greek Salad',     'Salads',       850, 2.80, 'R1006', 30),
            ('Garlic Bread',    'Starters',     450, 1.50, 'R1007', 60),
            ('Chicken Soup',    'Starters',     600, 2.00, 'R1008', 40),
            ('Spring Rolls',    'Starters',     550, 1.80, 'R1009', 40),
            ('Chocolate Cake',  'Desserts',     750, 2.50, 'R1010', 20),
            ('Ice Cream',       'Desserts',     500, 1.60, 'R1011', 25),
            ('Coca Cola',       'Beverages',    300, 1.00, 'R1012', 100),
            ('Mango Juice',     'Beverages',    400, 1.25, 'R1013', 80),
            ('Iced Coffee',     'Beverages',    480, 1.60, 'R1014', 60),
            ('Mineral Water',   'Beverages',    150, 0.50, 'R1015', 100),
        ]
        for name, cat, lkr, usd, bc, stock in menu:
            db.add(Product(
                name=name, category_id=cats[cat],
                price_lkr=lkr, price_usd=usd,
                barcode=bc, stock_quantity=stock,
            ))

        # Reseed tables
        for i in range(1, 13):
            db.add(RestaurantTable(name=f'Table {i}', capacity=4))

        db.commit()
        return jsonify({
            'ok': True,
            'categories': len(cat_names),
            'products':   len(menu),
            'tables':     12,
        })
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8001))
    app.run(host='0.0.0.0', port=port, debug=False)
