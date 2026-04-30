/**
 * LocalDbService — IndexedDB-backed implementation of the POS data layer.
 * Used in web-browser mode when no local Flask backend is available.
 * Dexie.js wraps IndexedDB; schema mirrors the Flask/SQLAlchemy models.
 */
import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import {
  ApiProduct, ApiCategory, ApiOrder, ApiOrderItem, ApiPayment,
  ApiTable, ApiTableStatus, ApiTableTransition, ApiStaff, ApiTerminal,
  ApiSyncLog, DashboardStats,
} from './api';

// ── Low-level row types ───────────────────────────────────────────────────────

export interface LSetting    { id?: number; key: string; value: string; }
export interface LStaff      { id?: number; uuid: string; username: string; display_name: string; role: string; pin_hash: string; is_active: number; failed_login_count: number; locked_until: string | null; updated_at: string; }
export interface LTerminal   { id?: number; uuid: string; terminal_code: string; terminal_name: string; outlet_uuid: string; outlet_code: string; outlet_name: string; currency: string; vat_rate: number; timezone: string; invoice_prefix: string; registered_at: string; }
export interface LCategory   { id?: number; uuid: string; name: string; color: string; icon: string | null; sort_order: number; is_visible: number; updated_at: string; sync_status: string; }
export interface LProduct    { id?: number; uuid: string; name: string; sku: string | null; barcode: string | null; category_id: number | null; price_lkr: number; price_usd: number; vat_rate: number; unit: string; track_stock: number; stock_quantity: number; is_available: number; updated_at: string; sync_status: string; }
export interface LTable      { id?: number; uuid: string; name: string; capacity: number; section: string | null; status_id: number; is_active: number; updated_at: string; sync_status: string; }
export interface LTableStatus { id?: number; code: string; label: string; color: string; sort_order: number; is_system: number; is_active: number; }
export interface LTableTransition { id?: number; from_status_id: number; to_status_id: number; trigger_type: string; trigger_event: string; }
export interface LOrder      { id?: number; uuid: string; staff_id: number | null; table_id: number | null; status: string; subtotal: number; discount_amount: number; service_charge: number; tax_amount: number; total_amount: number; paid_amount: number; change_amount: number; currency: string; notes: string | null; order_created_at: string; updated_at: string; sync_status: string; tax_invoice_no: string | null; terminal_order_ref: string | null; hq_order_id: string | null; }
export interface LOrderItem  { id?: number; uuid: string; order_id: number; product_id: number | null; product_name: string; product_sku: string | null; quantity: number; unit_price: number; discount_amount: number; vat_rate: number; vat_amount: number; line_total: number; notes: string | null; }
export interface LPayment    { id?: number; uuid: string; order_id: number; payment_method: string; amount: number; currency: string; card_last4: string | null; transaction_ref: string | null; status: string; paid_at: string; }
export interface LSyncLog    { id?: number; sync_type: string; direction: string; status: string; records_affected: number; error_message: string | null; started_at: string; finished_at: string | null; }

// ── Dexie database class ──────────────────────────────────────────────────────

export class PosLocalDb extends Dexie {
  settings!:          Table<LSetting,    number>;
  staff!:             Table<LStaff,      number>;
  terminals!:         Table<LTerminal,   number>;
  categories!:        Table<LCategory,   number>;
  products!:          Table<LProduct,    number>;
  restaurantTables!:  Table<LTable,      number>;
  tableStatuses!:     Table<LTableStatus, number>;
  tableTransitions!:  Table<LTableTransition, number>;
  orders!:            Table<LOrder,      number>;
  orderItems!:        Table<LOrderItem,  number>;
  payments!:          Table<LPayment,    number>;
  syncLog!:           Table<LSyncLog,    number>;

  constructor() {
    super('destinity-pos');
    this.version(1).stores({
      settings:         '++id, &key',
      staff:            '++id, uuid, username, role',
      terminals:        '++id, uuid, &terminal_code',
      categories:       '++id, uuid',
      products:         '++id, uuid, barcode, category_id',
      restaurantTables: '++id, uuid, status_id',
      tableStatuses:    '++id, &code',
      tableTransitions: '++id, from_status_id, to_status_id',
      orders:           '++id, uuid, status, sync_status, table_id, order_created_at',
      orderItems:       '++id, uuid, order_id',
      payments:         '++id, uuid, order_id',
      syncLog:          '++id, sync_type, started_at',
    });
  }
}

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

function todayStart(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

// ── LocalDbService ────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class LocalDbService {
  readonly db = new PosLocalDb();
  private _seedPromise: Promise<void> | null = null;

  constructor() { this._seedPromise = this._doSeed(); }

  _ensureSeeded(): Promise<void> {
    if (!this._seedPromise) this._seedPromise = this._doSeed();
    return this._seedPromise;
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  private async _doSeed(): Promise<void> {
    await this.db.open();

    // Default table statuses
    const tsCount = await this.db.tableStatuses.count();
    if (tsCount === 0) {
      await this.db.tableStatuses.bulkAdd([
        { code: 'available', label: 'Available', color: '#22c55e', sort_order: 1, is_system: 1, is_active: 1 },
        { code: 'seated',    label: 'Seated',    color: '#3b82f6', sort_order: 2, is_system: 1, is_active: 1 },
        { code: 'billed',    label: 'Billed',    color: '#f59e0b', sort_order: 3, is_system: 1, is_active: 1 },
        { code: 'blocked',   label: 'Blocked',   color: '#ef4444', sort_order: 4, is_system: 1, is_active: 1 },
      ]);
      // Transitions: available→seated, seated→billed, billed→available
      const avail  = await this.db.tableStatuses.get({ code: 'available' });
      const seated = await this.db.tableStatuses.get({ code: 'seated' });
      const billed = await this.db.tableStatuses.get({ code: 'billed' });
      if (avail?.id && seated?.id && billed?.id) {
        await this.db.tableTransitions.bulkAdd([
          { from_status_id: avail.id,  to_status_id: seated.id, trigger_type: 'manual', trigger_event: 'seat' },
          { from_status_id: seated.id, to_status_id: billed.id, trigger_type: 'manual', trigger_event: 'bill' },
          { from_status_id: billed.id, to_status_id: avail.id,  trigger_type: 'manual', trigger_event: 'clear' },
        ]);
      }
    }

    // Default staff
    const staffCount = await this.db.staff.count();
    if (staffCount === 0) {
      const adminHash   = await sha256('123456');
      const cashierHash = await sha256('1234');
      await this.db.staff.bulkAdd([
        { uuid: uuid(), username: 'admin',    display_name: 'Admin',    role: 'admin',   pin_hash: adminHash,   is_active: 1, failed_login_count: 0, locked_until: null, updated_at: nowIso() },
        { uuid: uuid(), username: 'cashier1', display_name: 'Cashier 1', role: 'cashier', pin_hash: cashierHash, is_active: 1, failed_login_count: 0, locked_until: null, updated_at: nowIso() },
      ]);
    }

    // Default settings
    const settCount = await this.db.settings.count();
    if (settCount === 0) {
      await this.db.settings.bulkAdd([
        { key: 'currency',        value: 'LKR' },
        { key: 'vat_rate',        value: '0' },
        { key: 'service_charge',  value: '0' },
        { key: 'invoice_prefix',  value: 'INV' },
        { key: 'cloud_api_url',   value: '' },
        { key: 'auto_sync_enabled', value: 'false' },
        { key: 'sync_interval_minutes', value: '10' },
      ]);
    }
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  async getSettings(): Promise<Record<string, string>> {
    await this._ensureSeeded();
    const rows = await this.db.settings.toArray();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  async getSetting(key: string): Promise<string> {
    await this._ensureSeeded();
    const row = await this.db.settings.get({ key });
    return row?.value ?? '';
  }

  async updateSetting(key: string, value: string): Promise<void> {
    await this._ensureSeeded();
    const existing = await this.db.settings.get({ key });
    if (existing?.id) await this.db.settings.update(existing.id, { value });
    else await this.db.settings.add({ key, value });
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
    await this._ensureSeeded();
    const rows = await this.db.staff.filter(s => !!s.is_active).toArray();
    return rows.map(this._toApiStaff);
  }

  async login(username: string, pin: string): Promise<{ success: boolean; staff?: ApiStaff; error?: string }> {
    await this._ensureSeeded();
    const s = await this.db.staff.filter(r => r.username === username && !!r.is_active).first();
    if (!s) return { success: false, error: 'Staff not found' };
    const hash = await sha256(pin);
    if (hash !== s.pin_hash) return { success: false, error: 'Incorrect PIN' };
    return { success: true, staff: this._toApiStaff(s) };
  }

  async createStaff(data: any): Promise<ApiStaff> {
    await this._ensureSeeded();
    const pinHash = data.pin ? await sha256(data.pin) : await sha256('1234');
    const id = await this.db.staff.add({
      uuid: uuid(), username: data.username, display_name: data.display_name || data.username,
      role: data.role || 'cashier', pin_hash: pinHash, is_active: 1,
      failed_login_count: 0, locked_until: null, updated_at: nowIso(),
    });
    return this._toApiStaff((await this.db.staff.get(id))!);
  }

  async updateStaff(id: number, data: any): Promise<ApiStaff> {
    const updates: Partial<LStaff> = { updated_at: nowIso() };
    if (data.display_name !== undefined) updates.display_name = data.display_name;
    if (data.role !== undefined) updates.role = data.role;
    if (data.is_active !== undefined) updates.is_active = data.is_active ? 1 : 0;
    await this.db.staff.update(id, updates);
    return this._toApiStaff((await this.db.staff.get(id))!);
  }

  async changeStaffPin(id: number, pin: string): Promise<void> {
    const hash = await sha256(pin);
    await this.db.staff.update(id, { pin_hash: hash, updated_at: nowIso() });
  }

  async deleteStaff(id: number): Promise<void> {
    await this.db.staff.update(id, { is_active: 0, updated_at: nowIso() });
  }

  private _toApiStaff(s: LStaff): ApiStaff {
    return { id: s.id!, uuid: s.uuid, username: s.username, display_name: s.display_name, role: s.role as any, is_active: !!s.is_active, failed_login_count: s.failed_login_count, locked_until: s.locked_until, updated_at: s.updated_at };
  }

  // ── Terminal ───────────────────────────────────────────────────────────────

  async registerTerminal(data: any): Promise<ApiTerminal> {
    await this._ensureSeeded();
    const settings = await this.getSettings();
    const existing = await this.db.terminals.get({ terminal_code: data.terminal_code });
    const t: LTerminal = {
      uuid: data.terminal_uuid || uuid(),
      terminal_code: data.terminal_code,
      terminal_name: data.terminal_name,
      outlet_uuid: data.outlet_uuid || uuid(),
      outlet_code: data.outlet_code,
      outlet_name: data.outlet_name,
      currency: settings['currency'] || 'LKR',
      vat_rate: parseFloat(settings['vat_rate'] || '0'),
      timezone: 'Asia/Colombo',
      invoice_prefix: settings['invoice_prefix'] || 'INV',
      registered_at: nowIso(),
    };
    if (existing?.id) {
      await this.db.terminals.update(existing.id, t);
      t.id = existing.id;
    } else {
      t.id = await this.db.terminals.add(t);
    }
    return this._toApiTerminal(t as LTerminal & { id: number });
  }

  async getTerminalInfo(): Promise<ApiTerminal> {
    const code = localStorage.getItem('terminal_code');
    const t = code ? await this.db.terminals.get({ terminal_code: code }) : await this.db.terminals.toCollection().first();
    if (!t) throw new Error('No terminal registered');
    return this._toApiTerminal(t as LTerminal & { id: number });
  }

  async clearTerminal(): Promise<void> {
    await this.db.terminals.clear();
  }

  private _toApiTerminal(t: LTerminal & { id: number }): ApiTerminal {
    return { terminal_uuid: t.uuid, terminal_code: t.terminal_code, terminal_name: t.terminal_name, outlet_uuid: t.outlet_uuid, outlet_code: t.outlet_code, outlet_name: t.outlet_name, currency: t.currency, vat_rate: t.vat_rate, timezone: t.timezone, invoice_prefix: t.invoice_prefix, registered_at: t.registered_at, last_master_sync_at: null, last_tx_sync_at: null };
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  async getCategories(): Promise<ApiCategory[]> {
    await this._ensureSeeded();
    return (await this.db.categories.toArray()).map(this._toApiCategory);
  }

  async createCategory(data: Partial<ApiCategory>): Promise<ApiCategory> {
    const id = await this.db.categories.add({
      uuid: uuid(), name: data.name || '', color: data.color || '#6366f1',
      icon: data.icon ?? null, sort_order: data.sort_order ?? 0,
      is_visible: data.is_visible !== false ? 1 : 0, updated_at: nowIso(), sync_status: 'pending',
    });
    return this._toApiCategory((await this.db.categories.get(id))!);
  }

  async updateCategory(id: number, data: Partial<ApiCategory>): Promise<ApiCategory> {
    const updates: Partial<LCategory> = { updated_at: nowIso(), sync_status: 'pending' };
    if (data.name !== undefined)       updates.name = data.name;
    if (data.color !== undefined)      updates.color = data.color;
    if (data.icon !== undefined)       updates.icon = data.icon;
    if (data.sort_order !== undefined) updates.sort_order = data.sort_order;
    if (data.is_visible !== undefined) updates.is_visible = data.is_visible ? 1 : 0;
    await this.db.categories.update(id, updates);
    return this._toApiCategory((await this.db.categories.get(id))!);
  }

  async deleteCategory(id: number): Promise<void> {
    await this.db.categories.delete(id);
  }

  private _toApiCategory(c: LCategory): ApiCategory {
    return { id: c.id!, uuid: c.uuid, name: c.name, color: c.color, icon: c.icon, sort_order: c.sort_order, is_visible: !!c.is_visible, updated_at: c.updated_at, synced_at: null };
  }

  // ── Products ───────────────────────────────────────────────────────────────

  async getProducts(): Promise<ApiProduct[]> {
    await this._ensureSeeded();
    return (await this.db.products.toArray()).map(this._toApiProduct);
  }

  async getProductByBarcode(barcode: string): Promise<ApiProduct> {
    const p = await this.db.products.get({ barcode });
    if (!p) throw new Error('Product not found');
    return this._toApiProduct(p);
  }

  async createProduct(data: Partial<ApiProduct>): Promise<ApiProduct> {
    const id = await this.db.products.add({
      uuid: uuid(), name: data.name || '', sku: data.sku ?? null, barcode: data.barcode ?? null,
      category_id: data.category_id ?? null,
      price_lkr: data.price_lkr ?? 0, price_usd: data.price_usd ?? 0,
      vat_rate: data.vat_rate ?? 0, unit: data.unit || 'pcs',
      track_stock: data.track_stock ? 1 : 0, stock_quantity: data.stock_quantity ?? -1,
      is_available: data.is_available !== false ? 1 : 0,
      updated_at: nowIso(), sync_status: 'pending',
    });
    return this._toApiProduct((await this.db.products.get(id))!);
  }

  async updateProduct(id: number, data: Partial<ApiProduct>): Promise<ApiProduct> {
    const updates: Partial<LProduct> = { updated_at: nowIso(), sync_status: 'pending' };
    const fields: (keyof ApiProduct)[] = ['name','sku','barcode','category_id','price_lkr','price_usd','vat_rate','unit','stock_quantity'];
    for (const f of fields) if (data[f] !== undefined) (updates as any)[f] = data[f];
    if (data.track_stock !== undefined) updates.track_stock = data.track_stock ? 1 : 0;
    if (data.is_available !== undefined) updates.is_available = data.is_available ? 1 : 0;
    await this.db.products.update(id, updates);
    return this._toApiProduct((await this.db.products.get(id))!);
  }

  async deleteProduct(id: number): Promise<void> {
    await this.db.products.delete(id);
  }

  private _toApiProduct(p: LProduct): ApiProduct {
    return { id: p.id!, uuid: p.uuid, outlet_product_uuid: null, category_id: p.category_id, name: p.name, sku: p.sku, barcode: p.barcode, image_url: null, price_lkr: p.price_lkr, price_usd: p.price_usd, vat_rate: p.vat_rate, unit: p.unit, track_stock: !!p.track_stock, stock_quantity: p.stock_quantity, is_available: !!p.is_available, updated_at: p.updated_at, synced_at: null };
  }

  // ── Tables ─────────────────────────────────────────────────────────────────

  async getTables(): Promise<ApiTable[]> {
    await this._ensureSeeded();
    const tables = await this.db.restaurantTables.filter(t => !!t.is_active).toArray();
    const statuses = await this.db.tableStatuses.toArray();
    const statusMap = new Map(statuses.map(s => [s.id!, s]));
    const transitions = await this.db.tableTransitions.toArray();
    return tables.map(t => this._toApiTable(t, statusMap, transitions));
  }

  async getTableStatuses(): Promise<ApiTableStatus[]> {
    await this._ensureSeeded();
    const statuses = await this.db.tableStatuses.filter(s => !!s.is_active).toArray();
    const transitions = await this.db.tableTransitions.toArray();
    return statuses.map(s => ({
      id: s.id!, code: s.code, label: s.label, color: s.color,
      sort_order: s.sort_order, is_system: !!s.is_system, is_active: !!s.is_active,
      transitions_from: transitions.filter(t => t.from_status_id === s.id).map(t => {
        const ts = statuses.find(ss => ss.id === t.to_status_id);
        return { to_status_id: t.to_status_id, to_status_code: ts?.code || '', to_status_label: ts?.label || '', to_status_color: ts?.color || '', trigger_type: t.trigger_type, trigger_event: t.trigger_event };
      }),
    }));
  }

  async updateTableStatus(id: number, toStatusCode: string): Promise<ApiTable> {
    const ts = await this.db.tableStatuses.get({ code: toStatusCode });
    if (!ts) throw new Error(`Unknown status: ${toStatusCode}`);
    await this.db.restaurantTables.update(id, { status_id: ts.id!, updated_at: nowIso(), sync_status: 'pending' });
    const tables = await this.getTables();
    return tables.find(t => t.id === id)!;
  }

  async createTable(data: any): Promise<ApiTable> {
    const available = await this.db.tableStatuses.get({ code: 'available' });
    const id = await this.db.restaurantTables.add({
      uuid: uuid(), name: data.name || 'Table', capacity: data.capacity ?? 4,
      section: data.section ?? null, status_id: available?.id ?? 1, is_active: 1,
      updated_at: nowIso(), sync_status: 'pending',
    });
    const tables = await this.getTables();
    return tables.find(t => t.id === id)!;
  }

  async updateTable(id: number, data: any): Promise<ApiTable> {
    const updates: Partial<LTable> = { updated_at: nowIso(), sync_status: 'pending' };
    if (data.name !== undefined)     updates.name = data.name;
    if (data.capacity !== undefined) updates.capacity = data.capacity;
    if (data.section !== undefined)  updates.section = data.section;
    await this.db.restaurantTables.update(id, updates);
    const tables = await this.getTables();
    return tables.find(t => t.id === id)!;
  }

  async deleteTable(id: number): Promise<void> {
    await this.db.restaurantTables.update(id, { is_active: 0, updated_at: nowIso() });
  }

  private _toApiTable(t: LTable, statusMap: Map<number, LTableStatus>, transitions: LTableTransition[]): ApiTable {
    const st = statusMap.get(t.status_id);
    const allowed = transitions.filter(tr => tr.from_status_id === t.status_id).map(tr => {
      const ts = statusMap.get(tr.to_status_id);
      return { to_status_id: tr.to_status_id, to_status_code: ts?.code || '', to_status_label: ts?.label || '', to_status_color: ts?.color || '', trigger_type: tr.trigger_type, trigger_event: tr.trigger_event };
    });
    return { id: t.id!, uuid: t.uuid, name: t.name, capacity: t.capacity, section: t.section, status_id: t.status_id, status_code: st?.code ?? null, status_label: st?.label ?? null, status_color: st?.color ?? null, is_active: !!t.is_active, updated_at: t.updated_at, synced_at: null, allowed_transitions: allowed };
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  async createOrder(data: any): Promise<ApiOrder> {
    await this._ensureSeeded();
    const settings = await this.getSettings();
    const currency  = settings['currency'] || 'LKR';
    const prefix    = settings['invoice_prefix'] || 'INV';
    const orderUuid = uuid();
    const now       = nowIso();

    // Calculate totals
    const items: any[] = data.items || [];
    let subtotal = 0;
    const itemRows: LOrderItem[] = items.map((item: any) => {
      const lineTotal = (item.unit_price ?? 0) * (item.quantity ?? 1);
      subtotal += lineTotal;
      return { uuid: uuid(), order_id: 0 /* filled after insert */, product_id: item.product_id ?? null, product_name: item.product_name || '', product_sku: item.product_sku ?? null, quantity: item.quantity ?? 1, unit_price: item.unit_price ?? 0, discount_amount: item.discount_amount ?? 0, vat_rate: item.vat_rate ?? 0, vat_amount: (item.vat_rate ?? 0) / 100 * lineTotal, line_total: lineTotal, notes: item.notes ?? null };
    });

    const discount  = data.discount_amount ?? 0;
    const svcCharge = data.service_charge ?? 0;
    const taxAmt    = data.tax_amount ?? 0;
    const total     = subtotal - discount + svcCharge + taxAmt;
    const paid      = data.paid_amount ?? total;
    const change    = Math.max(0, paid - total);

    // Invoice number
    const orderCount = await this.db.orders.count();
    const invNo = `${prefix}-${String(orderCount + 1).padStart(6, '0')}`;

    // Determine payments upfront so we know initial status
    const paymentData: any[] = data.payments || (data.payment_method ? [{ payment_method: data.payment_method, amount: paid, currency, card_last4: data.card_last4 ?? null }] : []);
    const hasPayment = paymentData.length > 0;

    // Status is pending until payment is confirmed (matches Flask 3-step flow)
    const orderId = await this.db.orders.add({
      uuid: orderUuid, staff_id: data.staff_id ?? null, table_id: data.table_id ?? null,
      status: hasPayment ? 'completed' : 'pending', subtotal, discount_amount: discount, service_charge: svcCharge,
      tax_amount: taxAmt, total_amount: total, paid_amount: paid, change_amount: change,
      currency, notes: data.notes ?? null, order_created_at: now, updated_at: now,
      sync_status: 'pending', tax_invoice_no: invNo, terminal_order_ref: data.terminal_order_ref ?? null,
      hq_order_id: null,
    });

    // Insert items
    for (const item of itemRows) {
      item.order_id = orderId;
      await this.db.orderItems.add(item);
    }

    // Insert payment(s)
    const payments: LPayment[] = [];
    for (const p of paymentData) {
      const pid = await this.db.payments.add({ uuid: uuid(), order_id: orderId, payment_method: p.payment_method, amount: p.amount ?? paid, currency: p.currency || currency, card_last4: p.card_last4 ?? null, transaction_ref: p.transaction_ref ?? null, status: 'completed', paid_at: now });
      payments.push((await this.db.payments.get(pid))!);
    }

    const order = (await this.db.orders.get(orderId))!;
    const orderItems = await this.db.orderItems.where('order_id').equals(orderId).toArray();
    return this._toApiOrder(order, orderItems, payments);
  }

  async getOrders(skip = 0, limit = 50): Promise<ApiOrder[]> {
    await this._ensureSeeded();
    const orders = await this.db.orders.orderBy('order_created_at').reverse().offset(skip).limit(limit).toArray();
    const results: ApiOrder[] = [];
    for (const o of orders) {
      const items    = await this.db.orderItems.where('order_id').equals(o.id!).toArray();
      const payments = await this.db.payments.where('order_id').equals(o.id!).toArray();
      results.push(this._toApiOrder(o, items, payments));
    }
    return results;
  }

  async getOrder(id: number): Promise<ApiOrder> {
    const o = await this.db.orders.get(id);
    if (!o) throw new Error('Order not found');
    const items    = await this.db.orderItems.where('order_id').equals(id).toArray();
    const payments = await this.db.payments.where('order_id').equals(id).toArray();
    return this._toApiOrder(o, items, payments);
  }

  async updateOrderStatus(id: number, status: string): Promise<void> {
    await this.db.orders.update(id, { status, updated_at: nowIso() });
  }

  async completeOrder(id: number): Promise<ApiOrder> {
    await this.db.orders.update(id, { status: 'completed', updated_at: nowIso() });
    // Reset the table back to 'available'
    const order = await this.db.orders.get(id);
    if (order?.table_id) {
      const available = await this.db.tableStatuses.get({ code: 'available' });
      if (available?.id) {
        await this.db.restaurantTables.update(order.table_id, { status_id: available.id, updated_at: nowIso() });
      }
    }
    return this.getOrder(id);
  }

  async addPayment(orderId: number, data: any): Promise<any> {
    const pid = await this.db.payments.add({ uuid: uuid(), order_id: orderId, payment_method: data.payment_method, amount: data.amount, currency: data.currency || 'LKR', card_last4: data.card_last4 ?? null, transaction_ref: data.transaction_ref ?? null, status: 'completed', paid_at: nowIso() });
    return this.db.payments.get(pid);
  }

  async getOrderStats(): Promise<DashboardStats> {
    await this._ensureSeeded();
    const todayStr = todayStart().toISOString();
    const todayOrders = await this.db.orders.where('order_created_at').aboveOrEqual(todayStr).filter(o => o.status === 'completed').toArray();
    const salesLkr  = todayOrders.reduce((sum, o) => sum + (o.currency === 'LKR' ? o.total_amount : 0), 0);
    const salesUsd  = todayOrders.reduce((sum, o) => sum + (o.currency === 'USD' ? o.total_amount : 0), 0);
    const count     = todayOrders.length;
    const active    = await this.db.restaurantTables.filter(t => !!t.is_active && t.status_id !== 1).count();
    return { sales_lkr: salesLkr, sales_usd: salesUsd, order_count: count, active_tables: active, avg_order_lkr: count ? salesLkr / count : 0 };
  }

  async getPendingOrders(): Promise<LOrder[]> {
    return this.db.orders.where('sync_status').equals('pending').toArray();
  }

  async markOrdersSynced(ids: number[], hqIds: Record<number, string>): Promise<void> {
    for (const id of ids) {
      await this.db.orders.update(id, { sync_status: 'synced', hq_order_id: hqIds[id] || null, updated_at: nowIso() });
    }
  }

  private _toApiOrder(o: LOrder, items: LOrderItem[], payments: LPayment[]): ApiOrder {
    return {
      id: o.id!, uuid: o.uuid, staff_id: o.staff_id, customer_id: null, table_id: o.table_id, table_name: null, terminal_order_ref: o.terminal_order_ref, tax_invoice_no: o.tax_invoice_no, currency: o.currency, subtotal: o.subtotal, discount_amount: o.discount_amount, discount_reason: null, service_charge: o.service_charge, tax_amount: o.tax_amount, total_amount: o.total_amount, paid_amount: o.paid_amount, change_amount: o.change_amount, status: o.status, void_reason: null, voided_by_staff_id: null, notes: o.notes, order_created_at: o.order_created_at, updated_at: o.updated_at, sync_status: o.sync_status, receipt_printed: false,
      items: items.map(i => ({ id: i.id!, uuid: i.uuid, order_id: i.order_id, product_uuid: null, product_id: i.product_id, product_name: i.product_name, product_sku: i.product_sku, quantity: i.quantity, unit_price: i.unit_price, discount_amount: i.discount_amount, vat_rate: i.vat_rate, vat_amount: i.vat_amount, line_total: i.line_total, notes: i.notes, created_at: null } as ApiOrderItem)),
      payments: payments.map(p => ({ id: p.id!, uuid: p.uuid, order_id: p.order_id, payment_method: p.payment_method, amount: p.amount, currency: p.currency, card_last4: p.card_last4, transaction_ref: p.transaction_ref, status: p.status, paid_at: p.paid_at } as ApiPayment)),
    };
  }

  // ── Sync log ───────────────────────────────────────────────────────────────

  async getSyncLog(): Promise<ApiSyncLog[]> {
    const rows = await this.db.syncLog.orderBy('started_at').reverse().limit(50).toArray();
    return rows.map(r => ({ id: r.id!, terminal_id: null, terminal_code: localStorage.getItem('terminal_code'), sync_type: r.sync_type, direction: r.direction, status: r.status, records_affected: r.records_affected, error_message: r.error_message, started_at: r.started_at, finished_at: r.finished_at }));
  }

  async addSyncLog(entry: Omit<LSyncLog, 'id'>): Promise<number> {
    return this.db.syncLog.add(entry);
  }

  async updateSyncLog(id: number, updates: Partial<LSyncLog>): Promise<void> {
    await this.db.syncLog.update(id, updates);
  }

  // ── Bulk apply (from cloud sync pull) ─────────────────────────────────────

  async applyMasterData(data: { categories?: any[]; products?: any[]; tables?: any[]; table_statuses?: any[] }): Promise<number> {
    let count = 0;

    if (data.categories?.length) {
      for (const c of data.categories) {
        const existing = await this.db.categories.get({ uuid: c.uuid });
        const row: Omit<LCategory, 'id'> = { uuid: c.uuid, name: c.name, color: c.color || '#6366f1', icon: c.icon ?? null, sort_order: c.sort_order ?? 0, is_visible: c.is_visible !== false ? 1 : 0, updated_at: c.updated_at || nowIso(), sync_status: 'synced' };
        if (existing?.id) await this.db.categories.update(existing.id, row); else await this.db.categories.add(row as LCategory);
        count++;
      }
    }

    if (data.products?.length) {
      for (const p of data.products) {
        const existing = await this.db.products.get({ uuid: p.uuid });
        const catRow = p.category_uuid ? await this.db.categories.get({ uuid: p.category_uuid }) : null;
        const row: Omit<LProduct, 'id'> = { uuid: p.uuid, name: p.name, sku: p.sku ?? null, barcode: p.barcode ?? null, category_id: catRow?.id ?? p.category_id ?? null, price_lkr: p.price_lkr ?? 0, price_usd: p.price_usd ?? 0, vat_rate: p.vat_rate ?? 0, unit: p.unit || 'pcs', track_stock: p.track_stock ? 1 : 0, stock_quantity: p.stock_quantity ?? -1, is_available: p.is_available !== false ? 1 : 0, updated_at: p.updated_at || nowIso(), sync_status: 'synced' };
        if (existing?.id) await this.db.products.update(existing.id, row); else await this.db.products.add(row as LProduct);
        count++;
      }
    }

    if (data.tables?.length) {
      for (const t of data.tables) {
        const existing = await this.db.restaurantTables.get({ uuid: t.uuid });
        const stRow = t.status_code ? await this.db.tableStatuses.get({ code: t.status_code }) : null;
        const row: Omit<LTable, 'id'> = { uuid: t.uuid, name: t.name, capacity: t.capacity ?? 4, section: t.section ?? null, status_id: stRow?.id ?? 1, is_active: t.is_active !== false ? 1 : 0, updated_at: t.updated_at || nowIso(), sync_status: 'synced' };
        if (existing?.id) await this.db.restaurantTables.update(existing.id, row); else await this.db.restaurantTables.add(row as LTable);
        count++;
      }
    }

    return count;
  }

  /** Get pending master records for pushing to cloud */
  async getPendingMasterData(): Promise<{ categories: LCategory[]; products: LProduct[]; tables: LTable[] }> {
    return {
      categories: await this.db.categories.where('sync_status').equals('pending').toArray(),
      products:   await this.db.products.where('sync_status').equals('pending').toArray(),
      tables:     await this.db.restaurantTables.where('sync_status').equals('pending').toArray(),
    };
  }

  async markMasterSynced(ids: { categories?: number[]; products?: number[]; tables?: number[] }): Promise<void> {
    if (ids.categories?.length) for (const id of ids.categories) await this.db.categories.update(id, { sync_status: 'synced' });
    if (ids.products?.length)   for (const id of ids.products)   await this.db.products.update(id,   { sync_status: 'synced' });
    if (ids.tables?.length)     for (const id of ids.tables)     await this.db.restaurantTables.update(id,     { sync_status: 'synced' });
  }
}
