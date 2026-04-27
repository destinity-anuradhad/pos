# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Start All Services (Windows)
```bash
dev.bat          # Installs deps + launches backend, frontend, and Electron concurrently
```

### Individual Services
```bash
npm run backend    # Flask API on :8000  (cd backend && python -m uvicorn main:app --reload --port 8000)
npm run frontend   # Angular on :4200
npm run electron   # Electron desktop wrapper
```

### Build
```bash
npm run build:web    # Production Angular bundle → frontend/dist/frontend/browser/
npm run build:win    # build:web + Electron NSIS installer (Windows)
npm run build:linux  # build:web + Electron AppImage
npm run android      # build:web + cap sync + open Android Studio
```

### Tests
```bash
cd frontend && ng test   # Vitest-based Angular unit tests (*.spec.ts)
```

## Architecture

**Destinity Inspire POS** is a cross-platform point-of-sale system with four deployment targets sharing one Angular frontend and one Flask backend.

```
Angular 21 (frontend/) ──HTTP──► Flask (backend/) ──SQLAlchemy──► SQLite
     │                                                              ├── restaurant.db
     ├── Electron (electron/)   wraps Angular dist, spawns Flask    └── retail.db
     ├── Capacitor (android/)   bundles Angular dist, hits hotspot
     └── Browser / PWA
```

### Mode System
The app operates in **restaurant** or **retail** mode, selected at login. Every API request carries an `X-POS-Mode` header. The backend's `utils.db_session()` reads this header and routes queries to either `restaurant.db` or `retail.db` — the two databases are completely independent with the same schema.

### API URL Resolution (frontend `api.ts`)
Priority order:
1. `localStorage['api_url']` — manual override
2. Electron detected → `http://localhost:8000/api`
3. Capacitor (Android) → `http://192.168.137.1:8000/api` (Windows hotspot default)
4. Fallback → `http://localhost:8000/api`

### Backend Structure (`backend/`)
- `main.py` — Flask app creation, CORS, blueprint registration, `/health` and `/` endpoints
- `database.py` — SQLAlchemy setup, dual-DB routing, auto-seed on first run
- `models/models.py` — Category, Product, RestaurantTable, Order, OrderItem, Setting
- `routes/` — One blueprint per resource: products, categories, orders, tables, sync, settings
- `utils.py` — `db_session()` reads `X-POS-Mode` header to pick the right DB session

### Frontend Structure (`frontend/src/app/`)
- `pages/` — login, mode-select, dashboard, customer-display
- `services/` — api.ts (typed HTTP), app-mode.ts (mode state), auth.ts, database.ts, sync.ts, scanner.ts, customer-display.ts, theme.ts
- `guards/` — auth.ts, mode-guard.ts

### Electron (`electron/main.js`)
Spawns `python main.py` as a subprocess, polls `/health` for up to 30 s, then opens a BrowserWindow. If `frontend/dist` exists it loads from file; otherwise loads `http://localhost:4200` (dev). On quit, kills the Flask process tree (`taskkill /f /t` on Windows, `SIGTERM` on Unix).

### Offline Sync
`GET /api/sync/pull` returns all categories, products, and tables with a timestamp.  
`POST /api/sync/push` accepts an array of orders created while offline.

### Deployment
Backend is deployed to Railway (`railway.toml`) with Gunicorn, two workers, and a `/data` volume for persistent SQLite files (`DB_PATH` env var points there).

## Key Ports

| Service | Port |
|---------|------|
| Angular dev server | 4200 |
| Flask API | 8000 |
| Android hotspot backend | 192.168.137.1:8000 |
