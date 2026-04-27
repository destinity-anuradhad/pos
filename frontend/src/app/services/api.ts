import { Injectable } from '@angular/core';
import { AppModeService } from './app-mode';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = 'http://localhost:8000/api';

  constructor(private modeService: AppModeService) {}

  private get headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-POS-Mode': this.modeService.getMode() || 'restaurant'
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
    return res.json();
  }

  // Products
  getProducts()                    { return this.request<any[]>('GET',    '/products/'); }
  getProductByBarcode(b: string)   { return this.request<any>('GET',     `/products/barcode/${b}`); }
  createProduct(data: any)         { return this.request<any>('POST',    '/products/', data); }
  updateProduct(id: number, d: any){ return this.request<any>('PUT',     `/products/${id}`, d); }
  deleteProduct(id: number)        { return this.request<any>('DELETE',  `/products/${id}`); }

  // Categories
  getCategories()                  { return this.request<any[]>('GET',   '/categories/'); }
  createCategory(data: any)        { return this.request<any>('POST',   '/categories/', data); }
  updateCategory(id: number, d: any){ return this.request<any>('PUT',   `/categories/${id}`, d); }
  deleteCategory(id: number)       { return this.request<any>('DELETE', `/categories/${id}`); }

  // Orders
  getOrders(skip = 0, limit = 50)  { return this.request<any[]>('GET',  `/orders/?skip=${skip}&limit=${limit}`); }
  getOrder(id: number)             { return this.request<any>('GET',    `/orders/${id}`); }
  createOrder(data: any)           { return this.request<any>('POST',   '/orders/', data); }
  updateOrderStatus(id: number, status: string) { return this.request<any>('PATCH', `/orders/${id}/status?status=${status}`); }

  // Tables (restaurant only)
  getTables()                      { return this.request<any[]>('GET',  '/tables/'); }
  createTable(data: any)           { return this.request<any>('POST',  '/tables/', data); }
  updateTableStatus(id: number, status: string) { return this.request<any>('PATCH', `/tables/${id}/status?status=${status}`); }

  // Settings
  getSettings()                    { return this.request<any>('GET',    '/settings/'); }
  updateSetting(key: string, value: string) { return this.request<any>('PUT', `/settings/${key}`, { value }); }

  // Sync
  pullData()                       { return this.request<any>('GET',   '/sync/pull'); }
  pushData(payload: any)           { return this.request<any>('POST',  '/sync/push', payload); }
}
