import os
import re
from flask import Flask, jsonify
from flask_cors import CORS
from database import init_db
from routes.sync       import sync_bp
from routes.products   import products_bp
from routes.categories import categories_bp
from routes.terminals  import terminals_bp
from routes.outlets    import outlets_bp
from routes.reports    import reports_bp
from routes.staff      import staff_bp
from routes.tables     import tables_bp
from routes.orders     import orders_bp
from routes.customers  import customers_bp

init_db()

app = Flask(__name__)

# Allow localhost origins only — no wildcard in production
_ALLOWED = re.compile(r'http://(localhost|127\.0\.0\.1)(:[0-9]+)?$')
CORS(app, origins=_ALLOWED, supports_credentials=False)

app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024   # 2 MB payload cap

app.register_blueprint(sync_bp,       url_prefix='/api/sync')
app.register_blueprint(products_bp,   url_prefix='/api/products')
app.register_blueprint(categories_bp, url_prefix='/api/categories')
app.register_blueprint(terminals_bp,  url_prefix='/api/terminals')
app.register_blueprint(outlets_bp,    url_prefix='/api/outlets')
app.register_blueprint(reports_bp,    url_prefix='/api/reports')
app.register_blueprint(staff_bp,      url_prefix='/api/staff')
app.register_blueprint(tables_bp,     url_prefix='/api/tables')
app.register_blueprint(orders_bp,     url_prefix='/api/orders')
app.register_blueprint(customers_bp,  url_prefix='/api/customers')


@app.get('/')
def root():
    return jsonify({
        'message': 'Destinity Inspire POS — Cloud HQ API',
        'version': '2.0.0',
        'endpoints': {
            'sync_pull':        'GET  /api/sync/pull',
            'sync_push':        'POST /api/sync/push',
            'outlets':          'GET  /api/outlets/',
            'terminals':        'GET  /api/terminals/',
            'staff':            'GET  /api/staff/',
            'categories':       'GET  /api/categories/',
            'products':         'GET  /api/products/',
            'tables':           'GET  /api/tables/',
            'orders':           'GET  /api/orders/',
            'customers':        'GET  /api/customers/',
            'reports_sales':    'GET  /api/reports/sales',
            'reports_stock':    'GET  /api/reports/stock',
            'reports_outlets':  'GET  /api/reports/outlets',
            'health':           'GET  /health',
        },
    })


@app.get('/health')
def health():
    return jsonify({'status': 'ok'})




if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8001))
    app.run(host='0.0.0.0', port=port, debug=False)
