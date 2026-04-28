import { Injectable, OnDestroy } from '@angular/core';
import { ApiService, resolveCloudBase } from './api';
import { TerminalService } from './terminal';

export interface SyncState {
  lastMasterSync: string | null;
  lastTransactionSync: string | null;
  pendingOrderCount: number;
  isSyncing: boolean;
  lastError: string | null;
}

const SYNC_STATE_KEY       = 'sync_state';
const CACHED_PRODUCTS_KEY  = 'cached_products';
const CACHED_TABLES_KEY    = 'cached_tables';
const CACHED_CATEGORIES_KEY = 'cached_categories';
const CACHED_STATUSES_KEY  = 'cached_table_statuses';
const PENDING_ORDERS_KEY   = 'pending_orders';

@Injectable({ providedIn: 'root' })
export class SyncService implements OnDestroy {
  private intervalHandle: any = null;
  private cloudBase = resolveCloudBase();

  private state: SyncState = {
    lastMasterSync: null,
    lastTransactionSync: null,
    pendingOrderCount: 0,
    isSyncing: false,
    lastError: null,
  };

  constructor(private api: ApiService, private terminal: TerminalService) {
    this.loadState();
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

  // ── Auto-sync timer ────────────────────────────────────────────────────────

  async startAutoSync(): Promise<void> {
    this.stopAutoSync();
    let intervalMinutes = 10;
    try {
      const ss = await this.api.getSyncSettings();
      if (ss.auto_sync_enabled) {
        intervalMinutes = ss.sync_interval_minutes || 10;
      } else {
        return; // auto-sync disabled
      }
    } catch {}

    const ms = intervalMinutes * 60 * 1000;
    this.intervalHandle = setInterval(() => this.syncAll(), ms);
  }

  stopAutoSync(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  ngOnDestroy(): void { this.stopAutoSync(); }

  // ── Auto-sync (timer) — pushes orders to cloud only ───────────────────────
  // Master data is cloud → local only; pulling it is a deliberate manual action.

  async syncAll(): Promise<void> {
    if (!navigator.onLine) return;
    await this.syncTransactions();
  }

  // ── Master data sync (cloud → local) ──────────────────────────────────────

  async syncMasterData(): Promise<{ success: boolean; error?: string }> {
    this.state.isSyncing = true;
    try {
      const res = await this.cloudRequest<any>('GET', '/sync/pull');

      if (res.categories)     localStorage.setItem(CACHED_CATEGORIES_KEY, JSON.stringify(res.categories));
      if (res.products)       localStorage.setItem(CACHED_PRODUCTS_KEY,   JSON.stringify(res.products));
      if (res.tables)         localStorage.setItem(CACHED_TABLES_KEY,     JSON.stringify(res.tables));
      if (res.table_statuses) localStorage.setItem(CACHED_STATUSES_KEY,   JSON.stringify(res.table_statuses));

      // Also push master data into local backend (Electron) so it's available offline
      await this.pushMasterToLocal(res);

      this.state.lastMasterSync = new Date().toISOString();
      this.state.lastError      = null;
      this.saveState();

      // Update cloud sync timestamp
      try {
        await this.cloudRequest('PATCH', '/settings/sync/timestamp', { type: 'master' });
      } catch {}

      return { success: true };
    } catch (e: any) {
      this.state.lastError = e?.message || 'Sync failed';
      return { success: false, error: this.state.lastError! };
    } finally {
      this.state.isSyncing = false;
    }
  }

  /** Push pulled master data into the local Flask backend (Electron). */
  private async pushMasterToLocal(data: any): Promise<void> {
    // For Electron: update local product stock from cloud
    if (!data.products) return;
    for (const p of data.products) {
      try {
        await this.api.updateProduct(p.id, {
          stock_quantity: p.stock_quantity,
          price_lkr:      p.price_lkr,
          price_usd:      p.price_usd,
        });
      } catch {}
    }
  }

  // ── Transaction sync (local → cloud) ──────────────────────────────────────

  async syncTransactions(): Promise<{ success: boolean; synced: number; error?: string }> {
    this.state.isSyncing = true;
    try {
      // Get unsynced orders from local backend
      const allOrders = await this.api.getOrders(0, 500);
      const pending   = allOrders.filter(o => o.sync_status === 'pending' || o.sync_status === 'failed');

      if (pending.length === 0) {
        this.state.pendingOrderCount = 0;
        this.state.lastTransactionSync = new Date().toISOString();
        this.saveState();
        return { success: true, synced: 0 };
      }

      // Fetch full order details (with items)
      const detailed = await Promise.all(
        pending.map(o => this.api.getOrder(o.id).catch(() => null))
      );
      const validOrders = detailed.filter(Boolean);

      const terminalId      = this.terminal.getTerminalId();
      const cloudTerminalId = this.terminal.getCloudTerminalId();
      const terminalCode    = this.terminal.getTerminalCode();
      const payload = {
        terminal_id:   cloudTerminalId ?? terminalId,
        terminal_code: terminalCode,
        orders: validOrders.map(o => ({
          terminal_order_ref: o!.terminal_order_ref,
          table_id:           o!.table_id,
          currency:           o!.currency,
          total_amount:       o!.total_amount,
          status:             o!.status,
          payment_method:     o!.payment_method,
          items:              (o!.items || []).map(i => ({
            product_id:   i.product_id,
            product_name: i.product_name,
            quantity:     i.quantity,
            unit_price:   i.unit_price,
            subtotal:     i.subtotal,
          })),
        })),
      };

      const result = await this.cloudRequest<any>('POST', '/sync/push', payload);

      if (result.results && result.results.length > 0) {
        // New format: per-order results with hq_order_id assigned by cloud
        for (const r of result.results) {
          if (r.status === 'synced' || r.status === 'already_synced') {
            const local = pending.find(o => o.terminal_order_ref === r.terminal_order_ref);
            if (local) {
              try {
                await this.api.request('PATCH', `/orders/${local.id}/hq-id`, {
                  hq_order_id: r.hq_order_id
                });
              } catch {}
            }
          }
        }
      } else if ((result.synced || 0) > 0) {
        // Old Railway format: no per-order results — mark all submitted orders as synced
        for (const o of pending) {
          try {
            await this.api.request('PATCH', `/orders/${o.id}/hq-id`, { hq_order_id: null });
          } catch {}
        }
      }

      this.state.lastTransactionSync = new Date().toISOString();
      // Re-count orders still needing sync
      try {
        const refreshed = await this.api.getOrders(0, 500);
        this.state.pendingOrderCount = refreshed.filter(
          o => o.sync_status === 'pending' || o.sync_status === 'failed'
        ).length;
      } catch {
        this.state.pendingOrderCount = result.errors || 0;
      }
      this.state.lastError           = null;
      this.saveState();

      try {
        await this.cloudRequest('PATCH', '/settings/sync/timestamp', { type: 'transactions' });
      } catch {}

      return { success: true, synced: result.synced || 0 };
    } catch (e: any) {
      this.state.lastError = e?.message || 'Transaction sync failed';
      return { success: false, synced: 0, error: this.state.lastError! };
    } finally {
      this.state.isSyncing = false;
    }
  }

  // ── Pending orders queue (for when even local backend is unreachable) ──────

  getPendingOrders(): any[] {
    try {
      return JSON.parse(localStorage.getItem(PENDING_ORDERS_KEY) || '[]');
    } catch { return []; }
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

  // ── Cached master data getters ─────────────────────────────────────────────

  getCachedProducts(): any[] {
    try { return JSON.parse(localStorage.getItem(CACHED_PRODUCTS_KEY) || '[]'); } catch { return []; }
  }

  getCachedTables(): any[] {
    try { return JSON.parse(localStorage.getItem(CACHED_TABLES_KEY) || '[]'); } catch { return []; }
  }

  getCachedCategories(): any[] {
    try { return JSON.parse(localStorage.getItem(CACHED_CATEGORIES_KEY) || '[]'); } catch { return []; }
  }

  getCachedTableStatuses(): any[] {
    try { return JSON.parse(localStorage.getItem(CACHED_STATUSES_KEY) || '[]'); } catch { return []; }
  }

  // ── Cloud HTTP helper ──────────────────────────────────────────────────────

  private async cloudRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${this.cloudBase}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Cloud API ${res.status}: ${path}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
