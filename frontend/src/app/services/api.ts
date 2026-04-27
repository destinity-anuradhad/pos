import { Injectable } from '@angular/core';
import { AppModeService } from './app-mode';

export interface ApiProduct {
  id: number; name: string; category: string; category_id: number;
  price_lkr: number; price_usd: number; barcode: string; is_active: boolean;
}

export interface ApiOrder {
  id: number; table_id: number | null; table_name: string;
  currency: string; total_amount: number; status: string;
  receipt_sent: boolean; item_count: number; created_at: string;
  items?: ApiOrderItem[];
}

export interface ApiOrderItem {
  id: number; product_id: number; product_name: string;
  quantity: number; unit_price: number; subtotal: number;
}

export interface ApiTable { id: number; name: string; capacity: number; status: string; }

export interface DashboardStats {
  sales_lkr: number; sales_usd: number; order_count: number;
  active_tables: number; avg_order_lkr: number;
}

// Priority order for API base URL:
//  1. localStorage 'api_url'  — full URL override, e.g. https://pos-api.railway.app/api
//  2. Electron desktop        — always localhost
//  3. Capacitor (Android)     — Windows hotspot default 192.168.137.1
function resolveApiBase(): string {
  const stored = localStorage.getItem('api_url');
  if (stored) return stored;

  const isElectron  = !!(window as any).electronAPI?.isElectron;
  const isCapacitor = typeof (window as any).Capacitor !== 'undefined' &&
                      (window as any).Capacitor?.isNativePlatform?.();

  if (isElectron)  return 'http://localhost:8000/api';
  if (isCapacitor) return 'http://192.168.137.1:8000/api';
  return 'http://localhost:8000/api';
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly base = resolveApiBase();

  constructor(private modeService: AppModeService) {}

  private get headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-POS-Mode': this.modeService.getMode() || 'restaurant',
    };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    return res.json();
  }

  // Products
  getProducts()                           { return this.request<ApiProduct[]>('GET',    '/products/'); }
  getProductByBarcode(b: string)          { return this.request<ApiProduct>('GET',     `/products/barcode/${encodeURIComponent(b)}`); }
  createProduct(data: Partial<ApiProduct>){ return this.request<ApiProduct>('POST',    '/products/', data); }
  updateProduct(id: number, d: Partial<ApiProduct>) { return this.request<ApiProduct>('PUT', `/products/${id}`, d); }
  deleteProduct(id: number)              { return this.request<any>('DELETE',           `/products/${id}`); }

  // Categories
  getCategories()                        { return this.request<any[]>('GET',   '/categories/'); }

  // Orders
  getOrderStats()                        { return this.request<DashboardStats>('GET', '/orders/stats'); }
  getOrders(skip = 0, limit = 50)        { return this.request<ApiOrder[]>('GET', `/orders/?skip=${skip}&limit=${limit}`); }
  getOrder(id: number)                   { return this.request<ApiOrder>('GET',  `/orders/${id}`); }
  createOrder(data: any)                 { return this.request<ApiOrder>('POST', '/orders/', data); }
  updateOrderStatus(id: number, status: string) { return this.request<any>('PATCH', `/orders/${id}/status?status=${status}`); }

  // Tables
  getTables()                            { return this.request<ApiTable[]>('GET', '/tables/'); }
  updateTableStatus(id: number, status: string) { return this.request<any>('PATCH', `/tables/${id}/status?status=${status}`); }

  // Settings
  getSettings()                          { return this.request<any>('GET', '/settings/'); }
  updateSetting(key: string, value: string) { return this.request<any>('PUT', `/settings/${key}`, { value }); }
}
