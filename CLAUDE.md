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
# Playwright E2E — tests live in test/ with their own package.json
cd test && npm test              # run all specs
cd test && npm test -- -g WEB    # browser/LocalDb tests only
cd test && npm test -- -g ELECTRON  # Electron desktop tests
cd test && npm test -- -g PARITY    # cross-platform consistency tests

# Root-level aliases delegate to test/ automatically:
npm test                  # same as cd test && npm test

# Angular unit tests
cd frontend && ng test    # no unit tests exist yet; skipTests: true is set globally
```

### Mobile
```bash
dev.bat android   # build:web + cap sync + open Android Studio
dev.bat apk       # build unsigned debug APK via Gradle (no Android Studio needed)
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
The app operates in **restaurant** or **retail** mode, selected at login. Every API request carries an `X-POS-Mode` header. The backend's `utils.db_session()` reads this header and routes queries to either `restaurant.db` or `retail.db` — the two databases are completely independent with the same schema. Currently `AppModeService.getMode()` defaults to `'restaurant'`; the retail path exists but is not yet active.

### API URL Resolution (frontend `api.ts`)
Priority order:
1. `localStorage['api_url']` — manual override (stripped if it contains `'railway.app'`)
2. Electron detected → `http://localhost:8000/api`
3. Capacitor (Android) → `http://192.168.137.1:8000/api` (Windows hotspot default)
4. Fallback → `http://localhost:8000/api`

### Backend Structure (`backend/`)
- `main.py` — Flask app creation, CORS (localhost/127.0.0.1 only via regex), blueprint registration, `/health` and `/` endpoints; `MAX_CONTENT_LENGTH` = 2 MB
- `database.py` — SQLAlchemy setup, dual-DB routing, `_seed_if_empty()` seeds system data, `_migrate_db()` safely adds missing columns to existing DBs (no Alembic)
- `models/models.py` — Category, Product, RestaurantTable, TableStatus, TableStatusTransition, Order, OrderItem, Terminal, SyncLog, Setting
- `routes/` — One blueprint per resource: `products`, `categories`, `orders`, `tables`, `sync`, `settings`, `terminals`, `table_statuses`, `auth`, `staff`; each file owns a `*_to_dict()` serializer and uses try/finally for `db.close()`
- `utils.py` — `db_session()` reads `X-POS-Mode` header to pick the right DB session
- `validation.py` — reusable validators (`validate_product()`, `validate_order()`, etc.), `safe_pagination()` (max 500), and enum constants (`VALID_ORDER_STATUSES`, `VALID_PAYMENT_METHODS`, `VALID_CURRENCIES`)
- `auth_utils.py` — JWT helpers; tokens expire after 8 h, secret stored in `Setting` table; `@require_auth()` decorator for protected routes; staff PINs hashed with bcrypt; default admin PIN is `1234` on first run

Schema is auto-created via `Base.metadata.create_all()` on startup — no migrations framework. Order statuses: `"pending"/"completed"/"cancelled"`. Table statuses are database-driven (configurable transitions), not hardcoded strings.

### Frontend Structure (`frontend/src/app/`)
- `pages/` — login, mode-select, dashboard, customer-display; all pages are **lazy-loaded** feature modules
- `services/api.ts` — typed HTTP with a generic `request<T>()` wrapper and typed interfaces (ApiProduct, ApiOrder, etc.)
- `services/database.ts` — **platform-switching data layer**: all pages depend on `DatabaseService`, which selects the right implementation at runtime:
  - `ApiService` (Electron + backend) → `http://localhost:8000/api`, 15 s `AbortController` timeout per request, errors thrown as `API {statusCode}: {path}`
  - `LocalDbService` (Browser/PWA) → IndexedDB via Dexie.js
  - `NativeDbService` (Capacitor Android/iOS) → Capacitor SQLite plugin v8
- Platform detection helpers used throughout: `isElectron()`, `isCapacitorNative()`, `isWebPlatform()`, `useLocalDb()` — keep these consistent when adding platform-specific code
- `services/inactivity.ts` — auto-locks after configurable timeout (default 5 min, reads `inactivity_timeout_minutes` from `localStorage`); listens on mousemove, keydown, touchstart, scroll, click
- `services/` — also: app-mode.ts (mode state), auth.ts (JWT stored **in memory only**, never localStorage), sync.ts, scanner.ts (barcode), customer-display.ts, keyboard-shortcuts.ts, theme.ts
- `guards/` — `authGuard`, `modeGuard`, `roleGuard` (checks `data.roles` on route definition)
- Router uses **HashLocationStrategy** — routes are `/#/pos`, `/#/dashboard`, etc.

Key `localStorage` keys: `pos_auth` (bypass login in tests), `pos_mode`, `api_url`, `inactivity_timeout_minutes`.

### Electron (`electron/main.js`)
Spawns `python main.py` as a subprocess with `DB_PATH` env var pointing to the OS user-data directory, polls `/health` for up to 30 s, then opens a BrowserWindow. Uses a custom HTTP server on **fixed port 8001** to serve `frontend/dist` (instead of `file://`, which blocks `getUserMedia` for camera; fixed port preserves `localStorage` origin). Explicitly grants camera/microphone permissions. On quit, kills the Flask process tree (`taskkill /f /t` on Windows, `SIGTERM` on Unix). Packaged with NSIS (Windows), DMG (macOS, unsigned), AppImage (Linux); Python backend + Angular dist bundled as `extraResources`, excluding `*.db` files.

### Playwright Tests (`test/`)
Tests seed `localStorage` to bypass login/mode selection and force the local API:
```typescript
const SEED = { pos_auth: 'true', pos_mode: 'restaurant', api_url: 'http://localhost:8000/api' };
```
Config: `test/playwright.config.ts` — 120 s timeout, headless: false, screenshots on failure.

### Offline Sync
`GET /api/sync/pull` returns all categories, products, and tables with a timestamp.  
`POST /api/sync/push` accepts an array of orders created while offline.  
Terminal registration is required before sync can occur. `SyncLog` tracks history (type, direction, status, records_affected).

### Stock Management
Product `stock` field: `-1` means unlimited, `0+` means tracked quantity.

### Deployment
Backend is deployed to Railway (`railway.toml`) with Gunicorn, two workers, and a `/data` volume for persistent SQLite files (`DB_PATH` env var points there; `PORT` is injected by Railway). The frontend is **not** deployed to Railway — it's bundled in the Electron installer or served as a static SPA. GitHub Actions (`.github/workflows/`) builds Android APK, unsigned iOS IPA, and unsigned macOS DMG on every push to `main`; artifacts are retained 30 days.

## Key Ports

| Service | Port |
|---------|------|
| Angular dev server | 4200 |
| Flask API | 8000 |
| Android hotspot backend | 192.168.137.1:8000 |
| Electron frontend server | 8001 |
