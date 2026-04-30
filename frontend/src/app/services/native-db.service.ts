/**
 * NativeDbService — SQLite-backed local data layer for Android (Capacitor).
 * Mirrors the full public interface of LocalDbService so DatabaseService can
 * swap between them transparently based on platform.
 *
 * Uses @capacitor-community/sqlite v8 plugin (Capacitor 8 compatible).
 */
import { Injectable } from '@angular/core';
import { CapacitorSQLite } from '@capacitor-community/sqlite';
import { isCapacitorNative } from './auth';
import {
  ApiProduct, ApiCategory, ApiOrder, ApiOrderItem, ApiPayment,
  ApiTable, ApiTableStatus, ApiStaff, ApiTerminal, ApiSyncLog, DashboardStats,
} from './api';
import { LSyncLog } from './local-db.service';

const DB = 'destinity-pos';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function sha256(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function nowIso(): string { return new Date().toISOString(); }

async function q(sql: string, vals: any[] = []): Promise<any[]> {
  const res = await CapacitorSQLite.query({ database: DB, statement: sql, values: vals });
  return res.values ?? [];
}

async function run(sql: string, vals: any[] = []): Promise<number> {
  const res = await CapacitorSQLite.run({ database: DB, statement: sql, values: vals, transaction: false });
  return res.changes?.lastId ?? 0;
}

async function exec(statements: string): Promise<void> {
  await CapacitorSQLite.execute({ database: DB, statements, transaction: false });
}

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS terminals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL,
  terminal_code TEXT UNIQUE NOT NULL,
  terminal_name TEXT NOT NULL,
  outlet_uuid TEXT NOT NULL,
  outlet_code TEXT NOT NULL,
  outlet_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'LKR',
  vat_rate REAL NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'Asia/Colombo',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  registered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  category_id INTEGER,
  price_lkr REAL NOT NULL DEFAULT 0,
  price_usd REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pcs',
  track_stock INTEGER NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  section TEXT,
  status_id INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS table_statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS table_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_status_id INTEGER NOT NULL,
  to_status_id INTEGER NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  trigger_event TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL,
  staff_id INTEGER,
  table_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  subtotal REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  service_charge REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  change_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'LKR',
  notes TEXT,
  order_created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  tax_invoice_no TEXT,
  terminal_order_ref TEXT,
  hq_order_id TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  product_sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL,
  order_id INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'LKR',
  card_last4 TEXT,
  transaction_ref TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  paid_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  records_affected INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
`;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class NativeDbService {
  private _initPromise: Promise<void> | null = null;

  constructor() { if (isCapacitorNative()) this._initPromise = this._init(); }

  private _ensureReady(): Promise<void> {
    if (!this._initPromise) this._initPromise = this._init();
    return this._initPromise;
  }

  private async _init(): Promise<void> {
    await CapacitorSQLite.createConnection({ database: DB, encrypted: false, mode: 'no-encryption', version: 1, readonly: false });
    await CapacitorSQLite.open({ database: DB });
    await exec(SCHEMA);
    await this._seed();
  }

  private async _seed(): Promise<void> {
    // Table statuses
    const tsRows = await q('SELECT COUNT(*) as cnt FROM table_statuses');
    if ((tsRows[0]?.cnt ?? 0) === 0) {
      await exec(`
        INSERT INTO table_statuses (code,label,color,sort_order,is_system,is_active) VALUES ('available','Available','#22c55e',1,1,1);
        INSERT INTO table_statuses (code,label,color,sort_order,is_system,is_active) VALUES ('seated','Seated','#3b82f6',2,1,1);
        INSERT INTO table_statuses (code,label,color,sort_order,is_system,is_active) VALUES ('billed','Billed','#f59e0b',3,1,1);
        INSERT INTO table_statuses (code,label,color,sort_order,is_system,is_active) VALUES ('blocked','Blocked','#ef4444',4,1,1);
      `);
      const avail  = (await q(`SELECT id FROM table_statuses WHERE code='available'`))[0]?.id;
      const seated = (await q(`SELECT id FROM table_statuses WHERE code='seated'`))[0]?.id;
      const billed = (await q(`SELECT id FROM table_statuses WHERE code='billed'`))[0]?.id;
      if (avail && seated && billed) {
        await exec(`
          INSERT INTO table_transitions (from_status_id,to_status_id,trigger_type,trigger_event) VALUES (${avail},${seated},'manual','seat');
          INSERT INTO table_transitions (from_status_id,to_status_id,trigger_type,trigger_event) VALUES (${seated},${billed},'manual','bill');
          INSERT INTO table_transitions (from_status_id,to_status_id,trigger_type,trigger_event) VALUES (${billed},${avail},'manual','clear');
        `);
      }
    }

    // Default staff
    const staffRows = await q('SELECT COUNT(*) as cnt FROM staff');
    if ((staffRows[0]?.cnt ?? 0) === 0) {
      const adminHash   = await sha256('123456');
      const cashierHash = await sha256('1234');
      const now = nowIso();
      await run(`INSERT INTO staff (uuid,username,display_name,role,pin_hash,is_active,failed_login_count,locked_until,updated_at) VALUES (?,?,?,?,?,1,0,NULL,?)`,
        [uuid(), 'admin', 'Admin', 'admin', adminHash, now]);
      await run(`INSERT INTO staff (uuid,username,display_name,role,pin_hash,is_active,failed_login_count,locked_until,updated_at) VALUES (?,?,?,?,?,1,0,NULL,?)`,
        [uuid(), 'cashier1', 'Cashier 1', 'cashier', cashierHash, now]);
    }

    // Default settings
    const settRows = await q('SELECT COUNT(*) as cnt FROM settings');
    if ((settRows[0]?.cnt ?? 0) === 0) {
      await exec(`
        INSERT INTO settings (key,value) VALUES ('currency','LKR');
        INSERT INTO settings (key,value) VALUES ('vat_rate','0');
        INSERT INTO settings (key,value) VALUES ('service_charge','0');
        INSERT INTO settings (key,value) VALUES ('invoice_prefix','INV');
        INSERT INTO settings (key,value) VALUES ('cloud_api_url','');
        INSERT INTO settings (key,value) VALUES ('auto_sync_enabled','false');
        INSERT INTO settings (key,value) VALUES ('sync_interval_minutes','10');
      `);
    }
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  async getSettings(): Promise<Record<string, string>> {
    await this._ensureReady();
    const rows = await q('SELECT key, value FROM settings');
    return Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  }

  async getSetting(key: string): Promise<string> {
    await this._ensureReady();
    const rows = await q('SELECT value FROM settings WHERE key = ?', [key]);
    return rows[0]?.value ?? '';
  }

  async updateSetting(key: string, value: string): Promise<void> {
    await this._ensureReady();
    await run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
  }

  async getSyncSettings(): Promise<any> {
    const s = await this.getSettings();
    return {
      id: 1,
      cloud_base_url: s['cloud_api_url'] || '',
      sync_interval_minutes: parseInt(s['sync_interval_minutes'] || '10'),
      auto_sync_enabled: s['auto_sync_enabled'] === 'true',
      last_master_sync_at: s['last_master_sync_at'] || null,
      last_tx_sync_at: s['last_tx_sync_at'] || null,
    };
  }

  // ── Staff / Auth ───────────────────────────────────────────────────────────

  async getStaffList(): Promise<ApiStaff[]> {
    await this._ensureReady();
    const rows = await q('SELECT * FROM staff WHERE is_active = 1');
    return rows.map(this._toApiStaff);
  }

  async login(username: string, pin: string): Promise<{ success: boolean; staff?: ApiStaff; error?: string }> {
    await this._ensureReady();
    const rows = await q('SELECT * FROM staff WHERE username = ? AND is_active = 1', [username]);
    if (!rows.length) return { success: false, error: 'Staff not found' };
    const s = rows[0];
    const hash = await sha256(pin);
    if (hash !== s.pin_hash) return { success: false, error: 'Incorrect PIN' };
    return { success: true, staff: this._toApiStaff(s) };
  }

  async createStaff(data: any): Promise<ApiStaff> {
    await this._ensureReady();
    const pinHash = await sha256(data.pin || '1234');
    const id = await run(
      `INSERT INTO staff (uuid,username,display_name,role,pin_hash,is_active,failed_login_count,locked_until,updated_at) VALUES (?,?,?,?,?,1,0,NULL,?)`,
      [uuid(), data.username, data.display_name, data.role || 'cashier', pinHash, nowIso()]
    );
    return this._toApiStaff((await q('SELECT * FROM staff WHERE id = ?', [id]))[0]);
  }

  async updateStaff(id: number, data: any): Promise<ApiStaff> {
    await this._ensureReady();
    const fields: string[] = [];
    const vals: any[] = [];
    if (data.display_name !== undefined) { fields.push('display_name=?'); vals.push(data.display_name); }
    if (data.role !== undefined) { fields.push('role=?'); vals.push(data.role); }
    if (data.is_active !== undefined) { fields.push('is_active=?'); vals.push(data.is_active ? 1 : 0); }
    fields.push('updated_at=?'); vals.push(nowIso());
    vals.push(id);
    if (fields.length > 1) await run(`UPDATE staff SET ${fields.join(',')} WHERE id=?`, vals);
    return this._toApiStaff((await q('SELECT * FROM staff WHERE id = ?', [id]))[0]);
  }

  async changeStaffPin(id: number, pin: string): Promise<void> {
    await this._ensureReady();
    const hash = await sha256(pin);
    await run('UPDATE staff SET pin_hash=?, updated_at=? WHERE id=?', [hash, nowIso(), id]);
  }

  async deleteStaff(id: number): Promise<void> {
    await this._ensureReady();
    await run('UPDATE staff SET is_active=0, updated_at=? WHERE id=?', [nowIso(), id]);
  }

  private _toApiStaff(r: any): ApiStaff {
    return { id: r.id, uuid: r.uuid, username: r.username, display_name: r.display_name, role: r.role, is_active: !!r.is_active, failed_login_count: r.failed_login_count ?? 0, locked_until: r.locked_until, updated_at: r.updated_at } as any;
  }

  // ── Terminal ───────────────────────────────────────────────────────────────

  async registerTerminal(data: any): Promise<ApiTerminal> {
    await this._ensureReady();
    await run('DELETE FROM terminals', []);
    const id = await run(
      `INSERT INTO terminals (uuid,terminal_code,terminal_name,outlet_uuid,outlet_code,outlet_name,currency,vat_rate,timezone,invoice_prefix,registered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [uuid(), data.terminal_code, data.terminal_name, data.outlet_uuid || uuid(), data.outlet_code, data.outlet_name, data.currency || 'LKR', data.vat_rate || 0, data.timezone || 'Asia/Colombo', data.invoice_prefix || 'INV', nowIso()]
    );
    return this._toApiTerminal((await q('SELECT * FROM terminals WHERE id = ?', [id]))[0]);
  }

  async getTerminalInfo(): Promise<ApiTerminal> {
    await this._ensureReady();
    const rows = await q('SELECT * FROM terminals LIMIT 1');
    if (!rows.length) throw new Error('No terminal registered');
    return this._toApiTerminal(rows[0]);
  }

  async clearTerminal(): Promise<void> {
    await this._ensureReady();
    await run('DELETE FROM terminals', []);
  }

  private _toApiTerminal(r: any): ApiTerminal {
    return { id: r.id, uuid: r.uuid, terminal_code: r.terminal_code, terminal_name: r.terminal_name, outlet_uuid: r.outlet_uuid, outlet_code: r.outlet_code, outlet_name: r.outlet_name, currency: r.currency, vat_rate: r.vat_rate, timezone: r.timezone, invoice_prefix: r.invoice_prefix, registered_at: r.registered_at, is_active: true } as any;
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  async getCategories(): Promise<ApiCategory[]> {
    await this._ensureReady();
    const rows = await q('SELECT * FROM categories WHERE is_visible = 1 ORDER BY sort_order');
    return rows.map(this._toApiCategory);
  }

  async createCategory(data: Partial<ApiCategory>): Promise<ApiCategory> {
    await this._ensureReady();
    const id = await run(
      `INSERT INTO categories (uuid,name,color,icon,sort_order,is_visible,updated_at,sync_status) VALUES (?,?,?,?,?,1,?,'pending')`,
      [uuid(), data.name, data.color || '#64748b', data.icon || null, data.sort_order ?? 0, nowIso()]
    );
    return this._toApiCategory((await q('SELECT * FROM categories WHERE id = ?', [id]))[0]);
  }

  async updateCategory(id: number, data: Partial<ApiCategory>): Promise<ApiCategory> {
    await this._ensureReady();
    const fields: string[] = [];
    const vals: any[] = [];
    if (data.name !== undefined) { fields.push('name=?'); vals.push(data.name); }
    if (data.color !== undefined) { fields.push('color=?'); vals.push(data.color); }
    if (data.icon !== undefined) { fields.push('icon=?'); vals.push(data.icon); }
    if (data.sort_order !== undefined) { fields.push('sort_order=?'); vals.push(data.sort_order); }
    fields.push('updated_at=?', "sync_status='pending'"); vals.push(nowIso());
    vals.push(id);
    await run(`UPDATE categories SET ${fields.join(',')} WHERE id=?`, vals);
    return this._toApiCategory((await q('SELECT * FROM categories WHERE id = ?', [id]))[0]);
  }

  async deleteCategory(id: number): Promise<void> {
    await this._ensureReady();
    await run('DELETE FROM categories WHERE id = ?', [id]);
  }

  private _toApiCategory(r: any): ApiCategory {
    return { id: r.id, uuid: r.uuid, name: r.name, color: r.color, icon: r.icon, sort_order: r.sort_order, is_visible: !!r.is_visible, updated_at: r.updated_at, sync_status: r.sync_status } as any;
  }

  // ── Products ───────────────────────────────────────────────────────────────

  async getProducts(): Promise<ApiProduct[]> {
    await this._ensureReady();
    const rows = await q('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.is_available = 1 ORDER BY p.name');
    return rows.map(this._toApiProduct);
  }

  async getProductByBarcode(barcode: string): Promise<ApiProduct> {
    await this._ensureReady();
    const rows = await q('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.barcode = ? LIMIT 1', [barcode]);
    if (!rows.length) throw new Error('Product not found');
    return this._toApiProduct(rows[0]);
  }

  async createProduct(data: Partial<ApiProduct>): Promise<ApiProduct> {
    await this._ensureReady();
    const id = await run(
      `INSERT INTO products (uuid,name,sku,barcode,category_id,price_lkr,price_usd,vat_rate,unit,track_stock,stock_quantity,is_available,updated_at,sync_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,'pending')`,
      [uuid(), data.name, data.sku || null, data.barcode || null, data.category_id || null, data.price_lkr ?? 0, data.price_usd ?? 0, data.vat_rate ?? 0, data.unit || 'pcs', data.track_stock ? 1 : 0, data.stock_quantity ?? 0, nowIso()]
    );
    return this._toApiProduct((await q('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?', [id]))[0]);
  }

  async updateProduct(id: number, data: Partial<ApiProduct>): Promise<ApiProduct> {
    await this._ensureReady();
    const fields: string[] = [];
    const vals: any[] = [];
    const map: Record<string, any> = { name: data.name, sku: data.sku, barcode: data.barcode, category_id: data.category_id, price_lkr: data.price_lkr, price_usd: data.price_usd, vat_rate: data.vat_rate, unit: data.unit };
    for (const [k, v] of Object.entries(map)) { if (v !== undefined) { fields.push(`${k}=?`); vals.push(v); } }
    if (data.track_stock !== undefined) { fields.push('track_stock=?'); vals.push(data.track_stock ? 1 : 0); }
    if (data.stock_quantity !== undefined) { fields.push('stock_quantity=?'); vals.push(data.stock_quantity); }
    fields.push('updated_at=?', "sync_status='pending'"); vals.push(nowIso()); vals.push(id);
    if (fields.length > 2) await run(`UPDATE products SET ${fields.join(',')} WHERE id=?`, vals);
    return this._toApiProduct((await q('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?', [id]))[0]);
  }

  async deleteProduct(id: number): Promise<void> {
    await this._ensureReady();
    await run('UPDATE products SET is_available=0, updated_at=? WHERE id=?', [nowIso(), id]);
  }

  private _toApiProduct(r: any): ApiProduct {
    return { id: r.id, uuid: r.uuid, name: r.name, sku: r.sku, barcode: r.barcode, category_id: r.category_id, category_name: r.category_name, price_lkr: r.price_lkr, price_usd: r.price_usd, vat_rate: r.vat_rate, unit: r.unit, track_stock: !!r.track_stock, stock_quantity: r.stock_quantity, is_available: !!r.is_available, updated_at: r.updated_at, sync_status: r.sync_status } as any;
  }

  // ── Tables ─────────────────────────────────────────────────────────────────

  async getTables(): Promise<ApiTable[]> {
    await this._ensureReady();
    const tables   = await q('SELECT * FROM restaurant_tables WHERE is_active = 1');
    const statuses = await q('SELECT * FROM table_statuses');
    const trans    = await q('SELECT * FROM table_transitions');
    const statusMap = new Map(statuses.map((s: any) => [s.id, s]));
    return tables.map((t: any) => this._toApiTable(t, statusMap, trans));
  }

  async getTableStatuses(): Promise<any[]> {
    await this._ensureReady();
    const statuses = await q('SELECT * FROM table_statuses WHERE is_active = 1 ORDER BY sort_order');
    const trans    = await q('SELECT * FROM table_transitions');
    return statuses.map((s: any) => {
      const statusMap = new Map(statuses.map((ss: any) => [ss.id, ss]));
      const allowed = trans.filter((tr: any) => tr.from_status_id === s.id).map((tr: any) => {
        const ts = statusMap.get(tr.to_status_id);
        return { to_status_id: tr.to_status_id, to_status_code: ts?.code || '', to_status_label: ts?.label || '', to_status_color: ts?.color || '', trigger_type: tr.trigger_type, trigger_event: tr.trigger_event };
      });
      return { id: s.id, code: s.code, label: s.label, color: s.color, sort_order: s.sort_order, is_system: !!s.is_system, is_active: !!s.is_active, transitions_from: allowed };
    });
  }

  async updateTableStatus(id: number, toStatusCode: string): Promise<ApiTable> {
    await this._ensureReady();
    const ts = (await q('SELECT id FROM table_statuses WHERE code = ?', [toStatusCode]))[0];
    if (!ts) throw new Error(`Status not found: ${toStatusCode}`);
    await run('UPDATE restaurant_tables SET status_id=?, updated_at=?, sync_status=? WHERE id=?', [ts.id, nowIso(), 'pending', id]);
    return (await this.getTables()).find((t: any) => t.id === id) as ApiTable;
  }

  async createTable(data: any): Promise<ApiTable> {
    await this._ensureReady();
    const available = (await q(`SELECT id FROM table_statuses WHERE code='available'`))[0];
    await run(
      `INSERT INTO restaurant_tables (uuid,name,capacity,section,status_id,is_active,updated_at,sync_status) VALUES (?,?,?,?,?,1,?,'pending')`,
      [uuid(), data.name, data.capacity || 4, data.section || null, available?.id ?? 1, nowIso()]
    );
    const tables = await this.getTables();
    return tables[tables.length - 1];
  }

  async updateTable(id: number, data: any): Promise<ApiTable> {
    await this._ensureReady();
    const fields: string[] = [];
    const vals: any[] = [];
    if (data.name !== undefined) { fields.push('name=?'); vals.push(data.name); }
    if (data.capacity !== undefined) { fields.push('capacity=?'); vals.push(data.capacity); }
    if (data.section !== undefined) { fields.push('section=?'); vals.push(data.section); }
    fields.push('updated_at=?', "sync_status='pending'"); vals.push(nowIso()); vals.push(id);
    if (fields.length > 2) await run(`UPDATE restaurant_tables SET ${fields.join(',')} WHERE id=?`, vals);
    return (await this.getTables()).find((t: any) => t.id === id) as ApiTable;
  }

  async deleteTable(id: number): Promise<void> {
    await this._ensureReady();
    await run('UPDATE restaurant_tables SET is_active=0, updated_at=? WHERE id=?', [nowIso(), id]);
  }

  private _toApiTable(t: any, statusMap: Map<number, any>, trans: any[]): ApiTable {
    const st = statusMap.get(t.status_id);
    const allowed = trans.filter((tr: any) => tr.from_status_id === t.status_id).map((tr: any) => {
      const ts = statusMap.get(tr.to_status_id);
      return { to_status_id: tr.to_status_id, to_status_code: ts?.code || '', to_status_label: ts?.label || '', to_status_color: ts?.color || '', trigger_type: tr.trigger_type, trigger_event: tr.trigger_event };
    });
    return { id: t.id, uuid: t.uuid, name: t.name, capacity: t.capacity, section: t.section, status_id: t.status_id, status_code: st?.code ?? null, status_label: st?.label ?? null, status_color: st?.color ?? null, is_active: !!t.is_active, updated_at: t.updated_at, synced_at: null, allowed_transitions: allowed } as any;
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  async createOrder(data: any): Promise<ApiOrder> {
    await this._ensureReady();
    const prefix   = await this.getSetting('invoice_prefix') || 'INV';
    const currency = data.currency || await this.getSetting('currency') || 'LKR';
    const orderUuid = uuid();
    const now = nowIso();

    // Compute per-item totals defensively (caller may omit line_total/vat_amount)
    let subtotal = 0;
    const itemRows = (data.items ?? []).map((item: any) => {
      const lineTotal  = item.line_total ?? (item.unit_price ?? 0) * (item.quantity ?? 1);
      const vatAmount  = item.vat_amount ?? (item.vat_rate ?? 0) / 100 * lineTotal;
      subtotal += lineTotal;
      return { ...item, line_total: lineTotal, vat_amount: vatAmount, discount_amount: item.discount_amount ?? 0 };
    });
    if (data.subtotal !== undefined) subtotal = data.subtotal; // caller override

    const discount  = data.discount_amount ?? 0;
    const svcCharge = data.service_charge ?? 0;
    const taxAmt    = data.tax_amount ?? 0;
    const total     = subtotal - discount + svcCharge + taxAmt;
    const paid      = data.paid_amount ?? total;
    const change    = Math.max(0, paid - total);

    const countRows = await q('SELECT COUNT(*) as cnt FROM orders');
    const invNo = `${prefix}-${String((countRows[0]?.cnt ?? 0) + 1).padStart(6, '0')}`;

    const paymentData: any[] = data.payments || (data.payment_method ? [{ payment_method: data.payment_method, amount: paid, currency }] : []);
    const hasPayment = paymentData.length > 0;

    const orderId = await run(
      `INSERT INTO orders (uuid,staff_id,table_id,status,subtotal,discount_amount,service_charge,tax_amount,total_amount,paid_amount,change_amount,currency,notes,order_created_at,updated_at,sync_status,tax_invoice_no,terminal_order_ref,hq_order_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      [orderUuid, data.staff_id ?? null, data.table_id ?? null, hasPayment ? 'completed' : 'pending', subtotal, discount, svcCharge, taxAmt, total, paid, change, currency, data.notes ?? null, now, now, 'pending', invNo, data.terminal_order_ref ?? null]
    );

    for (const item of itemRows) {
      await run(
        `INSERT INTO order_items (uuid,order_id,product_id,product_name,product_sku,quantity,unit_price,discount_amount,vat_rate,vat_amount,line_total,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uuid(), orderId, item.product_id ?? null, item.product_name, item.product_sku ?? null, item.quantity, item.unit_price, item.discount_amount, item.vat_rate ?? 0, item.vat_amount, item.line_total, item.notes ?? null]
      );
    }

    for (const p of paymentData) {
      await run(
        `INSERT INTO payments (uuid,order_id,payment_method,amount,currency,card_last4,transaction_ref,status,paid_at) VALUES (?,?,?,?,?,?,?,'completed',?)`,
        [uuid(), orderId, p.payment_method, p.amount ?? paid, p.currency || currency, p.card_last4 ?? null, p.transaction_ref ?? null, now]
      );
    }

    return this.getOrder(orderId);
  }

  async getOrders(skip = 0, limit = 50): Promise<ApiOrder[]> {
    await this._ensureReady();
    const orders = await q('SELECT * FROM orders ORDER BY order_created_at DESC LIMIT ? OFFSET ?', [limit, skip]);
    return Promise.all(orders.map((o: any) => this._buildApiOrder(o)));
  }

  async getOrder(id: number): Promise<ApiOrder> {
    await this._ensureReady();
    const rows = await q('SELECT * FROM orders WHERE id = ?', [id]);
    if (!rows.length) throw new Error('Order not found');
    return this._buildApiOrder(rows[0]);
  }

  async updateOrderStatus(id: number, status: string): Promise<void> {
    await this._ensureReady();
    await run('UPDATE orders SET status=?, updated_at=? WHERE id=?', [status, nowIso(), id]);
  }

  async completeOrder(id: number): Promise<ApiOrder> {
    await this._ensureReady();
    await run('UPDATE orders SET status=?, updated_at=? WHERE id=?', ['completed', nowIso(), id]);
    // Reset table to available
    const order = (await q('SELECT table_id FROM orders WHERE id = ?', [id]))[0];
    if (order?.table_id) {
      const available = (await q(`SELECT id FROM table_statuses WHERE code='available'`))[0];
      if (available?.id) await run('UPDATE restaurant_tables SET status_id=?, updated_at=? WHERE id=?', [available.id, nowIso(), order.table_id]);
    }
    return this.getOrder(id);
  }

  async addPayment(orderId: number, data: any): Promise<any> {
    await this._ensureReady();
    const id = await run(
      `INSERT INTO payments (uuid,order_id,payment_method,amount,currency,card_last4,transaction_ref,status,paid_at) VALUES (?,?,?,?,?,?,?,'completed',?)`,
      [uuid(), orderId, data.payment_method, data.amount, data.currency || 'LKR', data.card_last4 ?? null, data.transaction_ref ?? null, nowIso()]
    );
    return (await q('SELECT * FROM payments WHERE id = ?', [id]))[0];
  }

  async getOrderStats(): Promise<DashboardStats> {
    await this._ensureReady();
    const todayStr = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const todayOrders = await q(`SELECT * FROM orders WHERE order_created_at >= ? AND status = 'completed'`, [todayStr]);
    const salesLkr = todayOrders.filter((o: any) => o.currency === 'LKR').reduce((s: number, o: any) => s + o.total_amount, 0);
    const salesUsd = todayOrders.filter((o: any) => o.currency === 'USD').reduce((s: number, o: any) => s + o.total_amount, 0);
    const count    = todayOrders.length;
    const active   = (await q(`SELECT COUNT(*) as cnt FROM restaurant_tables WHERE is_active=1 AND status_id != (SELECT id FROM table_statuses WHERE code='available' LIMIT 1)`))[0]?.cnt ?? 0;
    return { sales_lkr: salesLkr, sales_usd: salesUsd, order_count: count, active_tables: active, avg_order_lkr: count ? salesLkr / count : 0 };
  }

  private async _buildApiOrder(o: any): Promise<ApiOrder> {
    const items    = await q('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
    const payments = await q('SELECT * FROM payments WHERE order_id = ?', [o.id]);
    return {
      id: o.id, uuid: o.uuid, staff_id: o.staff_id, customer_id: null, table_id: o.table_id, table_name: null,
      terminal_order_ref: o.terminal_order_ref, tax_invoice_no: o.tax_invoice_no, currency: o.currency,
      subtotal: o.subtotal, discount_amount: o.discount_amount, discount_reason: null, service_charge: o.service_charge,
      tax_amount: o.tax_amount, total_amount: o.total_amount, paid_amount: o.paid_amount, change_amount: o.change_amount,
      status: o.status, void_reason: null, voided_by_staff_id: null, notes: o.notes,
      order_created_at: o.order_created_at, updated_at: o.updated_at, sync_status: o.sync_status, receipt_printed: false,
      items: items.map((i: any) => ({ id: i.id, uuid: i.uuid, order_id: i.order_id, product_uuid: null, product_id: i.product_id, product_name: i.product_name, product_sku: i.product_sku, quantity: i.quantity, unit_price: i.unit_price, discount_amount: i.discount_amount, vat_rate: i.vat_rate, vat_amount: i.vat_amount, line_total: i.line_total, notes: i.notes, created_at: null } as ApiOrderItem)),
      payments: payments.map((p: any) => ({ id: p.id, uuid: p.uuid, order_id: p.order_id, payment_method: p.payment_method, amount: p.amount, currency: p.currency, card_last4: p.card_last4, transaction_ref: p.transaction_ref, status: p.status, paid_at: p.paid_at } as ApiPayment)),
    } as ApiOrder;
  }

  // ── Sync log ───────────────────────────────────────────────────────────────

  async getSyncLog(): Promise<ApiSyncLog[]> {
    await this._ensureReady();
    const rows = await q('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 100');
    return rows.map((r: any) => ({ id: r.id, terminal_id: null, terminal_code: null, sync_type: r.sync_type, direction: r.direction, status: r.status, records_affected: r.records_affected, error_message: r.error_message, started_at: r.started_at, finished_at: r.finished_at }));
  }

  async addSyncLog(entry: Omit<LSyncLog, 'id'>): Promise<number> {
    await this._ensureReady();
    return run(
      `INSERT INTO sync_log (sync_type,direction,status,records_affected,error_message,started_at,finished_at) VALUES (?,?,?,?,?,?,?)`,
      [entry.sync_type, entry.direction, entry.status, entry.records_affected, entry.error_message ?? null, entry.started_at, entry.finished_at ?? null]
    );
  }

  async updateSyncLog(id: number, updates: Partial<LSyncLog>): Promise<void> {
    await this._ensureReady();
    const fields: string[] = [];
    const vals: any[] = [];
    if (updates.status !== undefined) { fields.push('status=?'); vals.push(updates.status); }
    if (updates.records_affected !== undefined) { fields.push('records_affected=?'); vals.push(updates.records_affected); }
    if (updates.error_message !== undefined) { fields.push('error_message=?'); vals.push(updates.error_message); }
    if (updates.finished_at !== undefined) { fields.push('finished_at=?'); vals.push(updates.finished_at); }
    if (fields.length) { vals.push(id); await run(`UPDATE sync_log SET ${fields.join(',')} WHERE id=?`, vals); }
  }

  // ── Sync helpers ───────────────────────────────────────────────────────────

  async getPendingOrders(): Promise<any[]> {
    await this._ensureReady();
    return q(`SELECT * FROM orders WHERE sync_status = 'pending'`);
  }

  async markOrdersSynced(ids: number[], hqIds: Record<number, string>): Promise<void> {
    await this._ensureReady();
    for (const id of ids) {
      await run(`UPDATE orders SET sync_status='synced', hq_order_id=?, updated_at=? WHERE id=?`, [hqIds[id] || null, nowIso(), id]);
    }
  }

  async applyMasterData(data: { categories?: any[]; products?: any[]; tables?: any[] }): Promise<number> {
    await this._ensureReady();
    let count = 0;
    for (const c of (data.categories ?? [])) {
      const ex = (await q('SELECT id FROM categories WHERE uuid = ?', [c.uuid]))[0];
      if (ex) { await run(`UPDATE categories SET name=?,color=?,updated_at=?,sync_status='synced' WHERE id=?`, [c.name, c.color || '#64748b', nowIso(), ex.id]); }
      else { await run(`INSERT INTO categories (uuid,name,color,icon,sort_order,is_visible,updated_at,sync_status) VALUES (?,?,?,?,?,1,?,'synced')`, [c.uuid, c.name, c.color || '#64748b', c.icon || null, c.sort_order ?? 0, nowIso()]); }
      count++;
    }
    for (const p of (data.products ?? [])) {
      const ex = (await q('SELECT id FROM products WHERE uuid = ?', [p.uuid]))[0];
      if (ex) { await run(`UPDATE products SET name=?,price_lkr=?,price_usd=?,updated_at=?,sync_status='synced' WHERE id=?`, [p.name, p.price_lkr ?? 0, p.price_usd ?? 0, nowIso(), ex.id]); }
      else { await run(`INSERT INTO products (uuid,name,sku,barcode,category_id,price_lkr,price_usd,vat_rate,unit,track_stock,stock_quantity,is_available,updated_at,sync_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,'synced')`, [p.uuid, p.name, p.sku || null, p.barcode || null, p.category_id || null, p.price_lkr ?? 0, p.price_usd ?? 0, p.vat_rate ?? 0, p.unit || 'pcs', p.track_stock ? 1 : 0, p.stock_quantity ?? 0, nowIso()]); }
      count++;
    }
    for (const t of (data.tables ?? [])) {
      const ex = (await q('SELECT id FROM restaurant_tables WHERE uuid = ?', [t.uuid]))[0];
      const available = (await q(`SELECT id FROM table_statuses WHERE code='available'`))[0];
      if (ex) { await run(`UPDATE restaurant_tables SET name=?,capacity=?,updated_at=?,sync_status='synced' WHERE id=?`, [t.name, t.capacity ?? 4, nowIso(), ex.id]); }
      else { await run(`INSERT INTO restaurant_tables (uuid,name,capacity,section,status_id,is_active,updated_at,sync_status) VALUES (?,?,?,?,?,1,?,'synced')`, [t.uuid, t.name, t.capacity ?? 4, t.section || null, available?.id ?? 1, nowIso()]); }
      count++;
    }
    return count;
  }

  async getPendingMasterData(): Promise<any> {
    await this._ensureReady();
    const categories = await q(`SELECT * FROM categories WHERE sync_status = 'pending'`);
    const products   = await q(`SELECT * FROM products WHERE sync_status = 'pending'`);
    const tables     = await q(`SELECT * FROM restaurant_tables WHERE sync_status = 'pending'`);
    return { categories, products, tables };
  }

  async markMasterSynced(ids: { categoryIds?: number[]; productIds?: number[]; tableIds?: number[] }): Promise<void> {
    await this._ensureReady();
    for (const id of (ids.categoryIds ?? [])) await run(`UPDATE categories SET sync_status='synced' WHERE id=?`, [id]);
    for (const id of (ids.productIds ?? []))  await run(`UPDATE products SET sync_status='synced' WHERE id=?`, [id]);
    for (const id of (ids.tableIds ?? []))    await run(`UPDATE restaurant_tables SET sync_status='synced' WHERE id=?`, [id]);
  }
}
