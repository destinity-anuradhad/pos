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


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8001))
    app.run(host='0.0.0.0', port=port, debug=False)
