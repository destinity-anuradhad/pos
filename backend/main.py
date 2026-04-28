from flask import Flask, jsonify
from flask_cors import CORS
from database import init_db
from routes.products       import products_bp
from routes.categories     import categories_bp
from routes.orders         import orders_bp
from routes.tables         import tables_bp
from routes.sync           import sync_bp
from routes.settings       import settings_bp
from routes.terminals      import terminals_bp
from routes.table_statuses import table_statuses_bp

init_db()

app = Flask(__name__)
CORS(app)

app.register_blueprint(products_bp,       url_prefix='/api/products')
app.register_blueprint(categories_bp,     url_prefix='/api/categories')
app.register_blueprint(orders_bp,         url_prefix='/api/orders')
app.register_blueprint(tables_bp,         url_prefix='/api/tables')
app.register_blueprint(sync_bp,           url_prefix='/api/sync')
app.register_blueprint(settings_bp,       url_prefix='/api/settings')
app.register_blueprint(terminals_bp,      url_prefix='/api/terminals')
app.register_blueprint(table_statuses_bp, url_prefix='/api/table-statuses')

@app.get('/')
def root():
    return jsonify({'message': 'Destinity Inspire POS API', 'version': '2.0.0'})

@app.get('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)
