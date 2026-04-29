import { Injectable } from '@angular/core';
import { ApiService, ApiProduct, ApiOrder, ApiTable, ApiCategory, ApiStaff, DashboardStats } from './api';

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  constructor(private api: ApiService) {}

  // ── Products ──────────────────────────────────────────────────────
  getProducts(): Promise<ApiProduct[]>                                      { return this.api.getProducts(); }
  createProduct(data: Partial<ApiProduct>): Promise<ApiProduct>             { return this.api.createProduct(data); }
  updateProduct(id: number, d: Partial<ApiProduct>): Promise<ApiProduct>   { return this.api.updateProduct(id, d); }
  deleteProduct(id: number): Promise<any>                                   { return this.api.deleteProduct(id); }

  // ── Categories ───────────────────────────────────────────────────
  getCategories(): Promise<ApiCategory[]>                                   { return this.api.getCategories(); }
  createCategory(data: Partial<ApiCategory>): Promise<ApiCategory>          { return this.api.createCategory(data); }
  updateCategory(id: number, data: Partial<ApiCategory>): Promise<ApiCategory> { return this.api.updateCategory(id, data); }
  deleteCategory(id: number): Promise<any>                                  { return this.api.deleteCategory(id); }

  // ── Tables ────────────────────────────────────────────────────────
  getTables(): Promise<ApiTable[]>                                          { return this.api.getTables(); }
  updateTableStatus(id: number, toStatusCode: string): Promise<ApiTable>   { return this.api.updateTableStatus(id, toStatusCode); }
  createTable(data: any): Promise<ApiTable>                                 { return this.api.createTable(data); }
  updateTable(id: number, data: any): Promise<ApiTable>                    { return this.api.updateTable(id, data); }
  deleteTable(id: number): Promise<any>                                     { return this.api.deleteTable(id); }

  // ── Orders ────────────────────────────────────────────────────────
  createOrder(data: any): Promise<ApiOrder>                                 { return this.api.createOrder(data); }
  getOrders(skip = 0, limit = 50): Promise<ApiOrder[]>                     { return this.api.getOrders(skip, limit); }
  getOrderStats(): Promise<DashboardStats>                                  { return this.api.getOrderStats(); }

  // ── Staff ─────────────────────────────────────────────────────────
  getStaff(): Promise<ApiStaff[]>                                           { return this.api.getStaff(); }
}
