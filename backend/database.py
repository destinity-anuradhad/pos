import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

Base = declarative_base()

# DB_PATH env var lets cloud deployments (Railway volumes etc.) store data
# outside the ephemeral container filesystem.
_db_dir = os.environ.get('DB_PATH', '.')

_engines = {
    'restaurant': create_engine(f'sqlite:///{_db_dir}/restaurant.db', connect_args={'check_same_thread': False}),
    'retail':     create_engine(f'sqlite:///{_db_dir}/retail.db',     connect_args={'check_same_thread': False}),
}

_sessions = {
    mode: sessionmaker(autocommit=False, autoflush=False, bind=engine)
    for mode, engine in _engines.items()
}

def init_db():
    for engine in _engines.values():
        Base.metadata.create_all(bind=engine)
    _seed_if_empty()

def get_db(mode: str = 'restaurant'):
    SessionLocal = _sessions.get(mode) or _sessions['restaurant']
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def _seed_if_empty():
    """Seed default data into each DB if they are empty."""
    from models.models import Category, Product, RestaurantTable

    # ── Restaurant DB ────────────────────────────────────────────
    rs = _sessions['restaurant']()
    try:
        if rs.query(Product).count() == 0:
            cats = {}
            for name in ['Main Course','Salads','Starters','Desserts','Beverages']:
                c = Category(name=name); rs.add(c); rs.flush(); cats[name] = c.id

            menu = [
                ('Grilled Chicken',    'Main Course', 1800, 6.00,  'R1001'),
                ('Fried Rice',         'Main Course', 1200, 4.00,  'R1002'),
                ('Pasta Carbonara',    'Main Course', 1500, 5.00,  'R1003'),
                ('Beef Burger',        'Main Course', 1650, 5.50,  'R1004'),
                ('Caesar Salad',       'Salads',       900, 3.00,  'R1005'),
                ('Greek Salad',        'Salads',       850, 2.80,  'R1006'),
                ('Garlic Bread',       'Starters',     450, 1.50,  'R1007'),
                ('Chicken Soup',       'Starters',     600, 2.00,  'R1008'),
                ('Spring Rolls',       'Starters',     550, 1.80,  'R1009'),
                ('Chocolate Cake',     'Desserts',     750, 2.50,  'R1010'),
                ('Ice Cream',          'Desserts',     500, 1.60,  'R1011'),
                ('Coca Cola',          'Beverages',    300, 1.00,  'R1012'),
                ('Mango Juice',        'Beverages',    400, 1.25,  'R1013'),
                ('Iced Coffee',        'Beverages',    480, 1.60,  'R1014'),
                ('Mineral Water',      'Beverages',    150, 0.50,  'R1015'),
            ]
            for name, cat, lkr, usd, bc in menu:
                rs.add(Product(name=name, category_id=cats[cat], price_lkr=lkr, price_usd=usd, barcode=bc))

        if rs.query(RestaurantTable).count() == 0:
            for i in range(1, 13):
                rs.add(RestaurantTable(name=f'Table {i}', capacity=4, status='available'))

        rs.commit()
    finally:
        rs.close()

    # ── Retail DB ────────────────────────────────────────────────
    rt = _sessions['retail']()
    try:
        if rt.query(Product).count() == 0:
            cats = {}
            for name in ['Grocery','Dairy','Beverages','Personal Care','Stationery','Snacks']:
                c = Category(name=name); rt.add(c); rt.flush(); cats[name] = c.id

            items = [
                ('Basmati Rice 1kg',      'Grocery',       580, 1.90, '8901234560001'),
                ('Coconut Oil 500ml',     'Grocery',       620, 2.00, '8901234560002'),
                ('Sugar 1kg',             'Grocery',       290, 0.95, '8901234560003'),
                ('All Purpose Flour 1kg', 'Grocery',       310, 1.00, '8901234560004'),
                ('Milk 1L',               'Dairy',         260, 0.85, '8901234560005'),
                ('Cheddar Cheese 200g',   'Dairy',         850, 2.80, '8901234560006'),
                ('Butter 250g',           'Dairy',         680, 2.20, '8901234560007'),
                ('Coca Cola 330ml',       'Beverages',     180, 0.60, '8901234560008'),
                ('Orange Juice 1L',       'Beverages',     450, 1.50, '8901234560009'),
                ('Mineral Water 500ml',   'Beverages',      80, 0.25, '8901234560010'),
                ('Shampoo 200ml',         'Personal Care', 490, 1.60, '8901234560011'),
                ('Toothpaste 100g',       'Personal Care', 220, 0.72, '8901234560012'),
                ('Hand Soap 250ml',       'Personal Care', 280, 0.90, '8901234560013'),
                ('Notebook A4',           'Stationery',    350, 1.15, '8901234560014'),
                ('Ballpoint Pens 5pk',    'Stationery',    190, 0.62, '8901234560015'),
                ('Biscuits 200g',         'Snacks',        240, 0.78, '8901234560016'),
                ('Chocolate Bar',         'Snacks',        320, 1.05, '8901234560017'),
                ('Potato Chips 100g',     'Snacks',        280, 0.90, '8901234560018'),
            ]
            for name, cat, lkr, usd, bc in items:
                rt.add(Product(name=name, category_id=cats[cat], price_lkr=lkr, price_usd=usd, barcode=bc))

        rt.commit()
    finally:
        rt.close()
