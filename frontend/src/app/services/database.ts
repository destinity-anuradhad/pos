import { Injectable } from '@angular/core';
import { ApiService, ApiProduct, ApiOrder, ApiTable, ApiCategory, ApiStaff, ApiTableStatus, DashboardStats } from './api';
import { LocalDbService } from './local-db.service';
import { NativeDbService } from './native-db.service';
import { useLocalDb, isCapacitorNative } from './auth';

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private get _use(): boolean { return useLocalDb(); }
  private get _db(): LocalDbService | NativeDbService {
    return isCapacitorNative() ? this.native : this.local;
  }

  constructor(private api: ApiService, private local: LocalDbService, private native: NativeDbService) {}

  // ── Products ──────────────────────────────────────────────────────
  getProducts(): Promise<ApiProduct[]>                                    { return this._use ? this._db.getProducts()           : this.api.getProducts(); }
  getProductByBarcode(b: string): Promise<ApiProduct>                    { return this._use ? this._db.getProductByBarcode(b)  : this.api.getProductByBarcode(b); }
  createProduct(d: Partial<ApiProduct>): Promise<ApiProduct>             { return this._use ? this._db.createProduct(d)        : this.api.createProduct(d); }
  updateProduct(id: number, d: Partial<ApiProduct>): Promise<ApiProduct> { return this._use ? this._db.updateProduct(id, d)    : this.api.updateProduct(id, d); }
  deleteProduct(id: number): Promise<any>                                { return this._use ? this._db.deleteProduct(id)       : this.api.deleteProduct(id); }

  // ── Categories ───────────────────────────────────────────────────
  getCategories(): Promise<ApiCategory[]>                                         { return this._use ? this._db.getCategories()           : this.api.getCategories(); }
  createCategory(d: Partial<ApiCategory>): Promise<ApiCategory>                   { return this._use ? this._db.createCategory(d)         : this.api.createCategory(d); }
  updateCategory(id: number, d: Partial<ApiCategory>): Promise<ApiCategory>       { return this._use ? this._db.updateCategory(id, d)     : this.api.updateCategory(id, d); }
  deleteCategory(id: number): Promise<any>                                         { return this._use ? this._db.deleteCategory(id)        : this.api.deleteCategory(id); }

  // ── Tables ────────────────────────────────────────────────────────
  getTables(): Promise<ApiTable[]>                                        { return this._use ? this._db.getTables()               : this.api.getTables(); }
  getTableStatuses(): Promise<ApiTableStatus[]>                           { return this._use ? this._db.getTableStatuses()        : this.api.getTableStatuses(); }
  updateTableStatus(id: number, code: string): Promise<ApiTable>         { return this._use ? this._db.updateTableStatus(id, code) : this.api.updateTableStatus(id, code); }
  createTable(d: any): Promise<ApiTable>                                  { return this._use ? this._db.createTable(d)            : this.api.createTable(d); }
  updateTable(id: number, d: any): Promise<ApiTable>                     { return this._use ? this._db.updateTable(id, d)        : this.api.updateTable(id, d); }
  deleteTable(id: number): Promise<any>                                   { return this._use ? this._db.deleteTable(id)           : this.api.deleteTable(id); }

  // ── Orders ────────────────────────────────────────────────────────
  createOrder(d: any): Promise<ApiOrder>                                  { return this._use ? this._db.createOrder(d)            : this.api.createOrder(d); }
  getOrders(skip = 0, limit = 50): Promise<ApiOrder[]>                   { return this._use ? this._db.getOrders(skip, limit)    : this.api.getOrders(skip, limit); }
  getOrder(id: number): Promise<ApiOrder>                                 { return this._use ? this._db.getOrder(id)              : this.api.getOrder(id); }
  getOrderStats(): Promise<DashboardStats>                                { return this._use ? this._db.getOrderStats()           : this.api.getOrderStats(); }
  updateOrderStatus(id: number, status: string, voidReason?: string): Promise<any> { return this._use ? this._db.updateOrderStatus(id, status) : this.api.updateOrderStatus(id, status, voidReason); }
  addPayment(orderId: number, d: any): Promise<any>                      { return this._use ? this._db.addPayment(orderId, d)    : this.api.addPayment(orderId, d); }
  completeOrder(orderId: number): Promise<ApiOrder>                      { return this._use ? this._db.completeOrder(orderId)    : this.api.completeOrder(orderId); }

  // ── Staff ─────────────────────────────────────────────────────────
  getStaff(): Promise<ApiStaff[]>                                         { return this._use ? this._db.getStaffList()            : this.api.getStaff(); }
  createStaff(d: any): Promise<ApiStaff>                                  { return this._use ? this._db.createStaff(d)            : this.api.createStaff(d); }
  updateStaff(id: number, d: any): Promise<ApiStaff>                     { return this._use ? this._db.updateStaff(id, d)        : this.api.updateStaff(id, d); }
  changeStaffPin(id: number, pin: string): Promise<any>                  { return this._use ? this._db.changeStaffPin(id, pin)   : this.api.changeStaffPin(id, pin); }
  deleteStaff(id: number): Promise<any>                                   { return this._use ? this._db.deleteStaff(id)           : this.api.deleteStaff(id); }

  // ── Settings ──────────────────────────────────────────────────────
  getSettings(): Promise<any>                                             { return this._use ? this._db.getSettings()             : this.api.getSettings(); }
  updateSetting(key: string, value: string): Promise<any>                { return this._use ? this._db.updateSetting(key, value) : this.api.updateSetting(key, value); }
  getSyncSettings(): Promise<any>                                        { return this._use ? this._db.getSyncSettings()         : this.api.getSyncSettings(); }

  // ── Sync log ──────────────────────────────────────────────────────
  getSyncLog(): Promise<any[]>                                            { return this._use ? this._db.getSyncLog()              : this.api.getSyncLog(); }
}
