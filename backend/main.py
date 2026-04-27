from flask import Flask, jsonify, request
from flask_cors import CORS
from database import init_db
from routes.products import products_bp
from routes.categories import categories_bp
from routes.orders import orders_bp
from routes.tables import tables_bp
from routes.sync import sync_bp
from routes.settings import settings_bp

init_db()

app = Flask(__name__)
CORS(app)

app.register_blueprint(products_bp,    url_prefix='/api/products')
app.register_blueprint(categories_bp,  url_prefix='/api/categories')
app.register_blueprint(orders_bp,      url_prefix='/api/orders')
app.register_blueprint(tables_bp,      url_prefix='/api/tables')
app.register_blueprint(sync_bp,        url_prefix='/api/sync')
app.register_blueprint(settings_bp,    url_prefix='/api/settings')

@app.get('/')
def root():
    return jsonify({'message': 'Destinity Inspire POS API', 'version': '1.0.0'})

@app.get('/health')
def health():
    mode = request.headers.get('X-POS-Mode', 'restaurant')
    return jsonify({'status': 'ok', 'mode': mode})

if __name__ == '__main__':
    app.run(debug=True, port=8000)
