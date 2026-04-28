import { Injectable } from '@angular/core';
import { AuthService } from './auth';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ApiProduct {
  id: number; name: string; category: string; category_id: number;
  price_lkr: number; price_usd: number; barcode: string;
  stock_quantity: number; is_active: boolean;
  updated_at?: string; synced_at?: string;
}

export interface ApiOrder {
  id: number;
  terminal_id: number | null;
  terminal_order_ref: string | null;
  hq_order_id: number | null;
  table_id: number | null; table_name: string;
  currency: string; total_amount: number;
  status: string; payment_method: string | null;
  sync_status: string; receipt_sent: boolean;
  item_count: number; created_at: string; synced_at: string | null;
  items?: ApiOrderItem[];
}

export interface ApiOrderItem {
  id: number; product_id: number; product_name: string;
  quantity: number; unit_price: number; subtotal: number;
}

export interface ApiTable {
  id: number; name: string; capacity: number;
  status_id: number; status: string; status_label: string; status_color: string;
  updated_at?: string; synced_at?: string;
  allowed_transitions?: ApiTableTransition[];
}

export interface ApiTableTransition {
  to_status_id: number; to_status_code: string; to_status_label: string;
  to_status_color: string; trigger_type: string; trigger_event: string;
}

export interface ApiTableStatus {
  id: number; code: string; label: string; color: string;
  sort_order: number; is_system: boolean; is_active: boolean;
  transitions_from?: ApiTableTransition[];
}

export interface DashboardStats {
  sales_lkr: number; sales_usd: number; order_count: number;
  active_tables: number; avg_order_lkr: number;
}

export interface ApiTerminal {
  id: number; uuid: string; terminal_code: string; terminal_name: string;
  platform: string; is_active: boolean;
  registered_at: string; last_seen_at: string | null; registered_by: string | null;
}

export interface ApiSyncLog {
  id: number; terminal_id: number | null; terminal_code: string | null;
  sync_type: string; direction: string; status: string;
  records_affected: number; error_message: string | null; synced_at: string;
}

export interface SyncSettings {
  id: number; sync_interval_minutes: number; auto_sync_enabled: boolean;
  last_master_sync_at: string | null; last_transaction_sync_at: string | null;
}

// ── URL resolution ────────────────────────────────────────────────────────────

const RAILWAY_API = 'https://destinityinspire-pos.up.railway.app/api';
const LOCAL_API   = 'http://localhost:8000/api';

function isElectron(): boolean {
  return typeof (window as any).electronAPI !== 'undefined' ||
         navigator.userAgent.toLowerCase().includes('electron');
}

/** Local API base — Electron always uses localhost:8000 regardless of stored override */
function resolveLocalBase(): string {
  if (isElectron()) {
    // Clear any stale Railway URL that old builds may have stored
    const stored = localStorage.getItem('api_url');
    if (stored && (stored.includes('railway.app') || stored.includes('destinityinspire-pos'))) {
      localStorage.removeItem('api_url');
    }
    return LOCAL_API;
  }
  const stored = localStorage.getItem('api_url');
  if (stored) return stored;
  return LOCAL_API;   // fallback for dev; production web will use Railway via SyncService
}

/** Cloud API — always Railway (used by SyncService only) */
export function resolveCloudBase(): string {
  return RAILWAY_API;
}

// ── ApiService (talks to LOCAL backend) ──────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly base = resolveLocalBase();

  constructor(private auth: AuthService) {}

  private get headers(): HeadersInit {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const code = localStorage.getItem('terminal_code');
    if (code) h['X-Terminal-Code'] = code;
    const token = this.auth.getToken();
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: this.headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Products
  getProducts()                                              { return this.request<ApiProduct[]>('GET',    '/products/'); }
  getProductByBarcode(b: string)                             { return this.request<ApiProduct>('GET',     `/products/barcode/${encodeURIComponent(b)}`); }
  createProduct(data: Partial<ApiProduct>)                   { return this.request<ApiProduct>('POST',    '/products/', data); }
  updateProduct(id: number, d: Partial<ApiProduct>)          { return this.request<ApiProduct>('PUT',     `/products/${id}`, d); }
  deleteProduct(id: number)                                  { return this.request<any>('DELETE',          `/products/${id}`); }

  // Categories
  getCategories()                                                { return this.request<any[]>('GET',    '/categories/'); }
  createCategory(data: { name: string; color: string })         { return this.request<any>('POST',   '/categories/', data); }
  updateCategory(id: number, data: { name: string; color: string }) { return this.request<any>('PUT', `/categories/${id}`, data); }
  deleteCategory(id: number)                                    { return this.request<any>('DELETE', `/categories/${id}`); }

  // Orders
  getOrderStats()                                            { return this.request<DashboardStats>('GET', '/orders/stats'); }
  getOrders(skip = 0, limit = 50)                            { return this.request<ApiOrder[]>('GET', `/orders/?skip=${skip}&limit=${limit}`); }
  getOrder(id: number)                                       { return this.request<ApiOrder>('GET',  `/orders/${id}`); }
  createOrder(data: any)                                     { return this.request<ApiOrder>('POST', '/orders/', data); }
  updateOrderStatus(id: number, status: string)              { return this.request<any>('PATCH',     `/orders/${id}/status?status=${status}`); }

  // Tables
  getTables()                                                { return this.request<ApiTable[]>('GET', '/tables/'); }
  updateTableStatus(id: number, toStatusCode: string)        { return this.request<ApiTable>('PATCH', `/tables/${id}/status?status=${toStatusCode}`); }
  createTable(data: any)                                     { return this.request<ApiTable>('POST',  '/tables/', data); }
  updateTable(id: number, data: any)                         { return this.request<ApiTable>('PUT',   `/tables/${id}`, data); }
  deleteTable(id: number)                                    { return this.request<any>('DELETE',      `/tables/${id}`); }

  // Table statuses
  getTableStatuses()                                         { return this.request<ApiTableStatus[]>('GET',    '/table-statuses/'); }
  createTableStatus(data: any)                               { return this.request<ApiTableStatus>('POST',    '/table-statuses/', data); }
  updateTableStatus2(id: number, data: any)                  { return this.request<ApiTableStatus>('PUT',     `/table-statuses/${id}`, data); }
  deleteTableStatus(id: number)                              { return this.request<any>('DELETE',               `/table-statuses/${id}`); }
  getTransitions()                                           { return this.request<any[]>('GET',   '/table-statuses/transitions'); }
  addTransition(data: any)                                   { return this.request<any>('POST',    '/table-statuses/transitions', data); }
  deleteTransition(id: number)                               { return this.request<any>('DELETE',  `/table-statuses/transitions/${id}`); }

  // Terminals
  getTerminals()                                             { return this.request<ApiTerminal[]>('GET',  '/terminals/'); }
  registerTerminal(data: any)                                { return this.request<ApiTerminal>('POST',   '/terminals/', data); }
  getTerminalByUuid(uuid: string)                            { return this.request<ApiTerminal>('GET',    `/terminals/by-uuid/${uuid}`); }
  updateTerminal(id: number, data: any)                      { return this.request<ApiTerminal>('PUT',    `/terminals/${id}`, data); }
  terminalHeartbeat(id: number)                              { return this.request<any>('PATCH',           `/terminals/${id}/heartbeat`); }

  // Settings
  getSettings()                                              { return this.request<any>('GET', '/settings/'); }
  updateSetting(key: string, value: string)                  { return this.request<any>('PUT', `/settings/${key}`, { value }); }
  getSyncSettings()                                          { return this.request<SyncSettings>('GET', '/settings/sync'); }
  updateSyncSettings(data: any)                              { return this.request<any>('PUT',  '/settings/sync', data); }

  // Sync log
  getSyncLog(terminalId?: number)                            {
    const q = terminalId ? `?terminal_id=${terminalId}` : '';
    return this.request<ApiSyncLog[]>('GET', `/sync/log${q}`);
  }
}
