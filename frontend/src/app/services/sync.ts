import { Injectable, OnDestroy } from '@angular/core';
import { ApiService, resolveCloudBase } from './api';
import { TerminalService } from './terminal';
import { LocalDbService } from './local-db.service';
import { NativeDbService } from './native-db.service';
import { useLocalDb, isCapacitorNative } from './auth';

export interface SyncState {
  lastMasterSync: string | null;
  lastTransactionSync: string | null;
  pendingOrderCount: number;
  pendingMasterCount: number;
  isSyncing: boolean;
  lastError: string | null;
}

const SYNC_STATE_KEY        = 'sync_state';
const CACHED_PRODUCTS_KEY   = 'cached_products';
const CACHED_TABLES_KEY     = 'cached_tables';
const CACHED_CATEGORIES_KEY = 'cached_categories';
const CACHED_STATUSES_KEY   = 'cached_table_statuses';
const PENDING_ORDERS_KEY    = 'pending_orders';

@Injectable({ providedIn: 'root' })
export class SyncService implements OnDestroy {
  private intervalHandle: any = null;
  private get cloudBase(): string { return resolveCloudBase(); }

  private state: SyncState = {
    lastMasterSync: null, lastTransactionSync: null,
    pendingOrderCount: 0, pendingMasterCount: 0,
    isSyncing: false, lastError: null,
  };

  constructor(
    private api: ApiService,
    private terminal: TerminalService,
    private localDb: LocalDbService,
    private nativeDb: NativeDbService,
  ) {
    this.loadState();
  }

  private get _sdb(): LocalDbService | NativeDbService {
    return isCapacitorNative() ? this.nativeDb : this.localDb;
  }

  // ── State ──────────────────────────────────────────────────────────────────

  getState(): SyncState { return { ...this.state }; }

  private loadState(): void {
    const saved = localStorage.getItem(SYNC_STATE_KEY);
    if (saved) {
      try {
        const s = JSON.parse(saved);
        this.state.lastMasterSync      = s.lastMasterSync      || null;
        this.state.lastTransactionSync = s.lastTransactionSync || null;
        this.state.pendingOrderCount   = this.getPendingOrders().length;
      } catch {}
    }
  }

  private saveState(): void {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify({
      lastMasterSync:      this.state.lastMasterSync,
      lastTransactionSync: this.state.lastTransactionSync,
    }));
  }

  // ── Auto-sync ──────────────────────────────────────────────────────────────

  async startAutoSync(): Promise<void> {
    this.stopAutoSync();
    let intervalMinutes = 10;
    try {
      const ss = useLocalDb() ? await this._sdb.getSyncSettings() : await this.api.getSyncSettings();
      if (ss.auto_sync_enabled) {
        intervalMinutes = ss.sync_interval_minutes || 10;
      } else {
        return;
      }
    } catch {}
    const ms = intervalMinutes * 60 * 1000;
    this.intervalHandle = setInterval(() => this.syncAll(), ms);
  }

  stopAutoSync(): void {
    if (this.intervalHandle) { clearInterval(this.intervalHandle); this.intervalHandle = null; }
  }

  ngOnDestroy(): void { this.stopAutoSync(); }

  async syncAll(): Promise<void> {
    if (!navigator.onLine) return;
    await Promise.all([this.syncTransactions(), this.syncMasterDataUp()]);
  }

  // ── Master data DOWN: cloud → local ───────────────────────────────────────

  async syncMasterData(): Promise<{ success: boolean; error?: string }> {
    this.state.isSyncing = true;
    const logId = useLocalDb()
      ? await this._sdb.addSyncLog({ sync_type: 'master', direction: 'pull', status: 'running', records_affected: 0, error_message: null, started_at: new Date().toISOString(), finished_at: null })
      : null;

    try {
      const outletUuid   = this.terminal.getOutletUUID();
      const terminalUuid = this.terminal.getUUID();
      const pullPath = `/sync/pull?outlet_uuid=${encodeURIComponent(outletUuid || '')}&terminal_uuid=${encodeURIComponent(terminalUuid || '')}`;
      const res = await this.cloudRequest<any>('GET', pullPath);

      // Cache in localStorage for offline fallback
      if (res.categories)     localStorage.setItem(CACHED_CATEGORIES_KEY, JSON.stringify(res.categories));
      if (res.products)       localStorage.setItem(CACHED_PRODUCTS_KEY,   JSON.stringify(res.products));
      if (res.tables)         localStorage.setItem(CACHED_TABLES_KEY,     JSON.stringify(res.tables));
      if (res.table_statuses) localStorage.setItem(CACHED_STATUSES_KEY,   JSON.stringify(res.table_statuses));

      let affected = 0;
      if (useLocalDb()) {
        // Apply directly to IndexedDB
        affected = await this._sdb.applyMasterData({
          categories:    res.categories    || [],
          products:      res.products      || [],
          tables:        res.tables        || [],
          table_statuses: res.table_statuses || [],
        });
      } else {
        // Apply via Flask /sync/apply-master
        await this.api.request('POST', '/sync/apply-master', {
          categories: res.categories || [],
          products:   res.products   || [],
          tables:     res.tables     || [],
        });
        affected = (res.categories?.length || 0) + (res.products?.length || 0) + (res.tables?.length || 0);
      }

      this.state.lastMasterSync = new Date().toISOString();
      this.state.lastError      = null;
      this.saveState();
      await this.refreshPendingMasterCount();

      if (logId) await this._sdb.updateSyncLog(logId, { status: 'success', records_affected: affected, finished_at: new Date().toISOString() });
      return { success: true };
    } catch (e: any) {
      this.state.lastError = e?.message || 'Sync failed';
      if (logId) await this._sdb.updateSyncLog(logId, { status: 'failed', error_message: this.state.lastError, finished_at: new Date().toISOString() });
      return { success: false, error: this.state.lastError! };
    } finally {
      this.state.isSyncing = false;
    }
  }

  // ── Master data UP: local → cloud ─────────────────────────────────────────

  async syncMasterDataUp(): Promise<{ success: boolean; pushed: number; error?: string }> {
    this.state.isSyncing = true;
    const logId = useLocalDb()
      ? await this._sdb.addSyncLog({ sync_type: 'master', direction: 'push', status: 'running', records_affected: 0, error_message: null, started_at: new Date().toISOString(), finished_at: null })
      : null;

    try {
      let cats: any[], prods: any[], tables: any[];

      if (useLocalDb()) {
        const pending = await this._sdb.getPendingMasterData();
        cats   = pending.categories;
        prods  = pending.products;
        tables = pending.tables;
      } else {
        const pending = await this.api.request<any>('GET', '/sync/pending-master');
        cats   = pending.categories || [];
        prods  = pending.products   || [];
        tables = pending.tables     || [];
      }

      if (cats.length === 0 && prods.length === 0 && tables.length === 0) {
        this.state.pendingMasterCount = 0;
        if (logId) await this._sdb.updateSyncLog(logId, { status: 'success', records_affected: 0, finished_at: new Date().toISOString() });
        return { success: true, pushed: 0 };
      }

      const terminalCode = this.terminal.getTerminalCode();
      await this.cloudRequest('POST', '/sync/master/push', {
        terminal_code: terminalCode,
        terminal_uuid: this.terminal.getUUID(),
        outlet_uuid:   this.terminal.getOutletUUID(),
        outlet_code:   this.terminal.getOutletCode(),
        categories: cats, products: prods, tables,
      }).catch((e: any) => {
        // Cloud may not support master push — log and continue
        console.warn('[sync] master/push skipped:', e?.message);
      });

      if (useLocalDb()) {
        await this._sdb.markMasterSynced({
          categories: cats.map((c: any) => c.id),
          products:   prods.map((p: any) => p.id),
          tables:     tables.map((t: any) => t.id),
        });
      } else {
        await this.api.request('POST', '/sync/mark-master-synced', {
          category_ids: cats.map((c: any) => c.id),
          product_ids:  prods.map((p: any) => p.id),
          table_ids:    tables.map((t: any) => t.id),
        });
      }

      const pushed = cats.length + prods.length + tables.length;
      this.state.pendingMasterCount = 0;
      this.state.lastMasterSync     = new Date().toISOString();
      this.state.lastError          = null;
      this.saveState();

      if (logId) await this._sdb.updateSyncLog(logId, { status: 'success', records_affected: pushed, finished_at: new Date().toISOString() });
      return { success: true, pushed };
    } catch (e: any) {
      this.state.lastError = e?.message || 'Master sync failed';
      if (logId) await this._sdb.updateSyncLog(logId, { status: 'failed', error_message: this.state.lastError, finished_at: new Date().toISOString() });
      return { success: false, pushed: 0, error: this.state.lastError! };
    } finally {
      this.state.isSyncing = false;
    }
  }

  async refreshPendingMasterCount(): Promise<void> {
    try {
      if (useLocalDb()) {
        const p = await this._sdb.getPendingMasterData();
        this.state.pendingMasterCount = p.categories.length + p.products.length + p.tables.length;
      } else {
        const pending = await this.api.request<any>('GET', '/sync/pending-master');
        this.state.pendingMasterCount = (pending.categories?.length || 0) + (pending.products?.length || 0) + (pending.tables?.length || 0);
      }
    } catch {}
  }

  // ── Transaction sync (local → cloud) ──────────────────────────────────────

  async syncTransactions(): Promise<{ success: boolean; synced: number; error?: string }> {
    this.state.isSyncing = true;
    const logId = useLocalDb()
      ? await this._sdb.addSyncLog({ sync_type: 'transactions', direction: 'push', status: 'running', records_affected: 0, error_message: null, started_at: new Date().toISOString(), finished_at: null })
      : null;

    try {
      let pending: any[];

      if (useLocalDb()) {
        const rows = await this._sdb.getPendingOrders();
        const detailed: any[] = [];
        for (const o of rows) {
          try { detailed.push(await this._sdb.getOrder(o.id!)); } catch {}
        }
        pending = detailed;
      } else {
        const allOrders = await this.api.getOrders(0, 500);
        pending = allOrders.filter(o => o.sync_status === 'pending' || o.sync_status === 'failed');
        const detailed = await Promise.all(pending.map(o => this.api.getOrder(o.id).catch(() => null)));
        pending = detailed.filter(Boolean) as any[];
      }

      if (pending.length === 0) {
        this.state.pendingOrderCount   = 0;
        this.state.lastTransactionSync = new Date().toISOString();
        this.saveState();
        if (logId) await this._sdb.updateSyncLog(logId, { status: 'success', records_affected: 0, finished_at: new Date().toISOString() });
        return { success: true, synced: 0 };
      }

      const terminalCode = this.terminal.getTerminalCode();
      const payload = {
        terminal_code: terminalCode,
        terminal_uuid: this.terminal.getUUID(),
        outlet_uuid:   this.terminal.getOutletUUID(),
        outlet_code:   this.terminal.getOutletCode(),
        orders: pending.map(o => ({
          uuid:               o.uuid,
          terminal_order_ref: o.terminal_order_ref,
          table_id:           o.table_id,
          currency:           o.currency,
          subtotal:           o.subtotal,
          tax_amount:         o.tax_amount,
          total_amount:       o.total_amount,
          paid_amount:        o.paid_amount,
          change_amount:      o.change_amount,
          status:             o.status,
          order_created_at:   o.order_created_at,
          notes:              o.notes,
          items: (o.items || []).map((i: any) => ({
            uuid:         i.uuid,
            product_id:   i.product_id,
            product_uuid: i.product_uuid,
            product_name: i.product_name,
            product_sku:  i.product_sku,
            quantity:     i.quantity,
            unit_price:   i.unit_price,
            vat_rate:     i.vat_rate,
            vat_amount:   i.vat_amount,
            line_total:   i.line_total,
          })),
          payments: (o.payments || []).map((p: any) => ({
            uuid:            p.uuid,
            payment_method:  p.payment_method,
            amount:          p.amount,
            currency:        p.currency,
            card_last4:      p.card_last4,
            card_brand:      p.card_brand,
            transaction_ref: p.transaction_ref,
            status:          p.status,
            paid_at:         p.paid_at,
          })),
        })),
      };

      const result = await this.cloudRequest<any>('POST', '/sync/push', payload);

      // Backend returns {upserted, results: [{terminal_order_ref, hq_order_id}], timestamp}
      const syncedCount = result.upserted ?? result.synced ?? 0;
      const resultMap: Record<string, number> = {};
      if (result.results?.length) {
        for (const r of result.results) {
          if (r.terminal_order_ref) resultMap[r.terminal_order_ref] = r.hq_order_id;
        }
      }

      if (syncedCount > 0 || result.results?.length) {
        const ids = pending.map((o: any) => o.id);
        const hqIds: Record<number, string> = {};
        for (const o of pending) {
          if (resultMap[o.terminal_order_ref]) hqIds[o.id] = String(resultMap[o.terminal_order_ref]);
        }
        if (useLocalDb()) {
          await this._sdb.markOrdersSynced(ids, hqIds);
        } else {
          // Mark synced via local backend
          await this.api.request('POST', '/sync/mark-orders-synced', { order_ids: ids }).catch(() => {});
        }
      }

      this.state.lastTransactionSync = new Date().toISOString();
      this.state.pendingOrderCount   = useLocalDb() ? (await this._sdb.getPendingOrders()).length : 0;
      this.state.lastError           = null;
      this.saveState();

      if (logId) await this._sdb.updateSyncLog(logId, { status: 'success', records_affected: syncedCount, finished_at: new Date().toISOString() });
      return { success: true, synced: syncedCount };
    } catch (e: any) {
      this.state.lastError = e?.message || 'Transaction sync failed';
      if (logId) await this._sdb.updateSyncLog(logId, { status: 'failed', error_message: this.state.lastError, finished_at: new Date().toISOString() });
      return { success: false, synced: 0, error: this.state.lastError! };
    } finally {
      this.state.isSyncing = false;
    }
  }

  // ── Pending orders queue ───────────────────────────────────────────────────

  getPendingOrders(): any[] {
    try { return JSON.parse(localStorage.getItem(PENDING_ORDERS_KEY) || '[]'); } catch { return []; }
  }

  addPendingOrder(order: any): void {
    const orders = this.getPendingOrders();
    orders.push({ ...order, queued_at: new Date().toISOString() });
    localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(orders));
    this.state.pendingOrderCount = orders.length;
  }

  clearPendingOrders(): void {
    localStorage.removeItem(PENDING_ORDERS_KEY);
    this.state.pendingOrderCount = 0;
  }

  // ── Cached master data ─────────────────────────────────────────────────────

  getCachedProducts(): any[]      { try { return JSON.parse(localStorage.getItem(CACHED_PRODUCTS_KEY)   || '[]'); } catch { return []; } }
  getCachedTables(): any[]        { try { return JSON.parse(localStorage.getItem(CACHED_TABLES_KEY)     || '[]'); } catch { return []; } }
  getCachedCategories(): any[]    { try { return JSON.parse(localStorage.getItem(CACHED_CATEGORIES_KEY) || '[]'); } catch { return []; } }
  getCachedTableStatuses(): any[] { try { return JSON.parse(localStorage.getItem(CACHED_STATUSES_KEY)   || '[]'); } catch { return []; } }

  // ── Cloud HTTP helper ──────────────────────────────────────────────────────

  private async cloudRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.cloudBase) throw new Error('Cloud URL not configured. Set it in Sync → Admin Settings.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${this.cloudBase}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Cloud API ${res.status}: ${path}${text ? ' — ' + text.slice(0, 120) : ''}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
