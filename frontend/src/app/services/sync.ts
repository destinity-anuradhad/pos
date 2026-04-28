import { Injectable, OnDestroy } from '@angular/core';
import { ApiService, resolveCloudBase } from './api';
import { TerminalService } from './terminal';

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
  private cloudBase = resolveCloudBase();

  private state: SyncState = {
    lastMasterSync: null,
    lastTransactionSync: null,
    pendingOrderCount: 0,
    pendingMasterCount: 0,
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

  // ── Auto-sync (timer) — push orders + local master changes to cloud ────────

  async syncAll(): Promise<void> {
    if (!navigator.onLine) return;
    await Promise.all([
      this.syncTransactions(),
      this.syncMasterDataUp(),
    ]);
  }

  // ── Master data DOWN: cloud → local ───────────────────────────────────────

  async syncMasterData(): Promise<{ success: boolean; error?: string }> {
    this.state.isSyncing = true;
    try {
      const res = await this.cloudRequest<any>('GET', '/sync/pull');

      // Update localStorage caches (used by offline fallback)
      if (res.categories)     localStorage.setItem(CACHED_CATEGORIES_KEY, JSON.stringify(res.categories));
      if (res.products)       localStorage.setItem(CACHED_PRODUCTS_KEY,   JSON.stringify(res.products));
      if (res.tables)         localStorage.setItem(CACHED_TABLES_KEY,     JSON.stringify(res.tables));
      if (res.table_statuses) localStorage.setItem(CACHED_STATUSES_KEY,   JSON.stringify(res.table_statuses));

      // Bulk-apply into local backend via /sync/apply-master
      await this.api.request('POST', '/sync/apply-master', {
        categories: res.categories || [],
        products:   res.products   || [],
        tables:     res.tables     || [],
      });

      this.state.lastMasterSync = new Date().toISOString();
      this.state.lastError      = null;
      this.saveState();

      // Refresh pending master count (records just pulled are now synced)
      await this.refreshPendingMasterCount();

      return { success: true };
    } catch (e: any) {
      this.state.lastError = e?.message || 'Sync failed';
      return { success: false, error: this.state.lastError! };
    } finally {
      this.state.isSyncing = false;
    }
  }

  // ── Master data UP: local → cloud ─────────────────────────────────────────

  async syncMasterDataUp(): Promise<{ success: boolean; pushed: number; error?: string }> {
    this.state.isSyncing = true;
    try {
      // Get pending local master records
      const pending = await this.api.request<any>('GET', '/sync/pending-master');
      const cats    = pending.categories || [];
      const prods   = pending.products   || [];
      const tables  = pending.tables     || [];

      if (cats.length === 0 && prods.length === 0 && tables.length === 0) {
        this.state.pendingMasterCount = 0;
        return { success: true, pushed: 0 };
      }

      const terminalCode = this.terminal.getTerminalCode();
      await this.cloudRequest('POST', '/sync/master/push', {
        terminal_code: terminalCode,
        categories:    cats,
        products:      prods,
        tables:        tables,
      });

      // Mark all pushed records as synced locally
      await this.api.request('POST', '/sync/mark-master-synced', {
        category_ids: cats.map((c: any) => c.id),
        product_ids:  prods.map((p: any) => p.id),
        table_ids:    tables.map((t: any) => t.id),
      });

      this.state.pendingMasterCount = 0;
      this.state.lastMasterSync     = new Date().toISOString();
      this.state.lastError          = null;
      this.saveState();

      return { success: true, pushed: cats.length + prods.length + tables.length };
    } catch (e: any) {
      this.state.lastError = e?.message || 'Master sync failed';
      return { success: false, pushed: 0, error: this.state.lastError! };
    } finally {
      this.state.isSyncing = false;
    }
  }

  /** Refresh the pending master count from local backend. */
  async refreshPendingMasterCount(): Promise<void> {
    try {
      const pending = await this.api.request<any>('GET', '/sync/pending-master');
      const cats    = (pending.categories || []).length;
      const prods   = (pending.products   || []).length;
      const tables  = (pending.tables     || []).length;
      this.state.pendingMasterCount = cats + prods + tables;
    } catch {}
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
        // Per-order results with hq_order_id assigned by cloud
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
        // Old format fallback: mark all submitted orders as synced
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
      this.state.lastError = null;
      this.saveState();

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
