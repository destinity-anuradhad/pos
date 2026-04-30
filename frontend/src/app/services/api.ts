import { Injectable } from '@angular/core';
import { AuthService } from './auth';
import { AppModeService } from './app-mode';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ApiProduct {
  id: number; uuid: string; outlet_product_uuid: string | null;
  category_id: number | null; name: string; sku: string | null;
  barcode: string | null; image_url: string | null;
  price_lkr: number; price_usd: number;
  vat_rate: number; unit: string;
  track_stock: boolean; stock_quantity: number;
  is_available: boolean;
  updated_at?: string | null; synced_at?: string | null;
}

export interface ApiCategory {
  id: number; uuid: string; name: string; color: string;
  icon: string | null; sort_order: number; is_visible: boolean;
  updated_at?: string | null; synced_at?: string | null;
}

export interface ApiOrderItem {
  id: number; uuid: string; order_id: number;
  product_uuid: string | null; product_id: number | null;
  product_name: string; product_sku: string | null;
  quantity: number; unit_price: number;
  discount_amount: number; vat_rate: number; vat_amount: number;
  line_total: number; notes: string | null;
  created_at: string | null;
}

export interface ApiPayment {
  id: number; uuid: string; order_id: number;
  payment_method: string; amount: number; currency: string;
  card_last4: string | null; transaction_ref: string | null;
  status: string; paid_at: string;
}

export interface ApiOrder {
  id: number; uuid: string;
  staff_id: number | null; customer_id: number | null;
  table_id: number | null; table_name: string | null; terminal_order_ref: string | null;
  tax_invoice_no: string | null; currency: string;
  subtotal: number; discount_amount: number; discount_reason: string | null;
  service_charge: number; tax_amount: number; total_amount: number;
  paid_amount: number; change_amount: number;
  status: string; void_reason: string | null;
  voided_by_staff_id: number | null; notes: string | null;
  order_created_at: string | null; updated_at: string | null;
  sync_status: string; receipt_printed: boolean;
  items?: ApiOrderItem[];
  payments?: ApiPayment[];
}

export interface ApiTable {
  id: number; uuid: string; name: string; capacity: number;
  section: string | null; status_id: number;
  status_code: string | null; status_label: string | null; status_color: string | null;
  is_active: boolean;
  updated_at?: string | null; synced_at?: string | null;
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

export interface ApiStaff {
  id: number; uuid: string; username: string; display_name: string;
  role: 'cashier' | 'manager' | 'admin'; is_active: boolean;
  failed_login_count: number; locked_until: string | null;
  updated_at: string | null;
}

export interface ApiCustomer {
  id: number; uuid: string; phone: string | null; name: string | null;
  email: string | null; loyalty_card_no: string | null;
  loyalty_points: number; notes: string | null;
  updated_at: string | null; synced_at: string | null; sync_status: string;
}

export interface DashboardStats {
  sales_lkr: number; sales_usd: number; order_count: number;
  active_tables: number; avg_order_lkr: number;
}

export interface ApiTerminal {
  terminal_uuid: string; terminal_code: string; terminal_name: string;
  outlet_uuid: string; outlet_code: string; outlet_name: string;
  currency: string; vat_rate: number; timezone: string; invoice_prefix: string;
  registered_at: string | null;
  last_master_sync_at: string | null; last_tx_sync_at: string | null;
}

export interface ApiSyncLog {
  id: number; terminal_id: number | null; terminal_code: string | null;
  sync_type: string; direction: string; status: string;
  records_affected: number; error_message: string | null;
  started_at: string | null; finished_at: string | null;
}

export interface SyncSettings {
  id: number; cloud_base_url: string;
  sync_interval_minutes: number; auto_sync_enabled: boolean;
  last_master_sync_at: string | null; last_tx_sync_at: string | null;
}

// ── URL resolution ────────────────────────────────────────────────────────────

const LOCAL_API = 'http://localhost:8000/api';

function isElectron(): boolean {
  return typeof (window as any).electronAPI !== 'undefined' ||
         navigator.userAgent.toLowerCase().includes('electron');
}

/** Local API base — Electron always uses localhost:8000 regardless of stored override */
function resolveLocalBase(): string {
  if (isElectron()) {
    const stored = localStorage.getItem('api_url');
    if (stored && (stored.includes('railway.app') || stored.includes('destinityinspire-pos'))) {
      localStorage.removeItem('api_url');
    }
    return LOCAL_API;
  }
  const stored = localStorage.getItem('api_url');
  if (stored) return stored;
  return LOCAL_API;
}

/** Cloud API base (used by SyncService only). Returns '' when not configured. */
export function resolveCloudBase(): string {
  return localStorage.getItem('cloud_api_url') || '';
}

// ── ApiService (talks to LOCAL backend) ──────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly base = resolveLocalBase();

  constructor(private auth: AuthService, private mode: AppModeService) {}

  private get headers(): HeadersInit {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-POS-Mode': this.mode.getMode(),
    };
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
  getCategories()                                                   { return this.request<ApiCategory[]>('GET',    '/categories/'); }
  createCategory(data: Partial<ApiCategory>)                        { return this.request<ApiCategory>('POST',   '/categories/', data); }
  updateCategory(id: number, data: Partial<ApiCategory>)            { return this.request<ApiCategory>('PUT',    `/categories/${id}`, data); }
  deleteCategory(id: number)                                        { return this.request<any>('DELETE',          `/categories/${id}`); }

  // Orders
  getOrderStats()                                            { return this.request<DashboardStats>('GET', '/orders/stats'); }
  getOrders(skip = 0, limit = 50)                            { return this.request<ApiOrder[]>('GET', `/orders/?skip=${skip}&limit=${limit}`); }
  getOrder(id: number)                                       { return this.request<ApiOrder>('GET',  `/orders/${id}`); }
  createOrder(data: any)                                     { return this.request<ApiOrder>('POST', '/orders/', data); }
  updateOrderStatus(id: number, status: string, voidReason?: string) {
    const body: any = { status };
    if (voidReason) body.void_reason = voidReason;
    return this.request<any>('PUT', `/orders/${id}/status`, body);
  }
  addPayment(orderId: number, data: { payment_method: string; amount: number; currency: string; card_last4?: string; card_brand?: string }) {
    return this.request<ApiPayment>('POST', `/orders/${orderId}/payments`, data);
  }
  completeOrder(orderId: number) { return this.request<ApiOrder>('PUT', `/orders/${orderId}/status`, { status: 'completed' }); }

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

  // Staff
  getStaff()                                                 { return this.request<ApiStaff[]>('GET',  '/staff/'); }
  createStaff(data: any)                                     { return this.request<ApiStaff>('POST',   '/staff/', data); }
  updateStaff(id: number, data: any)                         { return this.request<ApiStaff>('PUT',    `/staff/${id}`, data); }
  changeStaffPin(id: number, pin: string)                    { return this.request<any>('POST', `/staff/${id}/change-pin`, { pin }); }
  deleteStaff(id: number)                                    { return this.request<any>('DELETE',       `/staff/${id}`); }

  // Terminals
  getTerminals()                                             { return this.request<ApiTerminal[]>('GET',  '/terminals/'); }
  registerTerminal(data: any)                                { return this.request<ApiTerminal>('POST',   '/terminals/register', data); }
  getTerminalInfo()                                          { return this.request<ApiTerminal>('GET',    '/terminals/info'); }
  deleteTerminalInfo()                                       { return this.request<any>('DELETE',          '/terminals/info'); }
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
