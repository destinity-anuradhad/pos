import { Injectable } from '@angular/core';
import { ApiService, ApiProduct, ApiOrder, ApiTable, DashboardStats } from './api';

/**
 * All data persistence goes through the Flask API.
 * This service is a thin wrapper so pages are decoupled from ApiService directly.
 */
@Injectable({ providedIn: 'root' })
export class DatabaseService {
  constructor(private api: ApiService) {}

  // ── Products ──────────────────────────────────────────────────────
  getProducts(): Promise<ApiProduct[]>                              { return this.api.getProducts(); }
  createProduct(data: Partial<ApiProduct>): Promise<ApiProduct>    { return this.api.createProduct(data); }
  updateProduct(id: number, d: Partial<ApiProduct>): Promise<ApiProduct> { return this.api.updateProduct(id, d); }
  deleteProduct(id: number): Promise<any>                          { return this.api.deleteProduct(id); }

  // ── Tables ────────────────────────────────────────────────────────
  getTables(): Promise<ApiTable[]>                                  { return this.api.getTables(); }
  updateTableStatus(id: number, status: string): Promise<any>      { return this.api.updateTableStatus(id, status); }

  // ── Orders ────────────────────────────────────────────────────────
  createOrder(data: any): Promise<ApiOrder>                        { return this.api.createOrder(data); }
  getOrders(skip = 0, limit = 50): Promise<ApiOrder[]>             { return this.api.getOrders(skip, limit); }
  getOrderStats(): Promise<DashboardStats>                         { return this.api.getOrderStats(); }
}
