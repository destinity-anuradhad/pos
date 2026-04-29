import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { DatabaseService } from '../../services/database';
import { ScannerService } from '../../services/scanner';
import { AppModeService } from '../../services/app-mode';
import { ApiProduct, ApiCategory } from '../../services/api';

@Component({
  selector: 'app-products',
  standalone: false,
  templateUrl: './products.html',
  styleUrls: ['./products.scss']
})
export class Products implements OnInit {
  isRestaurant = false;
  products: ApiProduct[] = [];
  filteredProducts: ApiProduct[] = [];
  categories: ApiCategory[] = [];
  searchTerm = '';
  loading = true;
  error = '';

  showForm = false;
  editingId: number | null = null;
  form = {
    name: '', category_id: null as number | null,
    sku: '', barcode: '',
    price_lkr: 0, price_usd: 0,
    vat_rate: 0, unit: 'pcs',
    track_stock: false, stock_quantity: -1,
    is_available: true,
  };

  scanningBarcode = false;
  lookupStatus: 'idle' | 'loading' | 'found' | 'not-found' | 'error' = 'idle';
  lookupMessage = '';

  isMobile = typeof (window as any).Capacitor !== 'undefined' &&
             (window as any).Capacitor?.isNativePlatform?.();

  categoryName(id: number | null): string {
    if (!id) return '—';
    return this.categories.find(c => c.id === id)?.name ?? '—';
  }

  constructor(
    private db: DatabaseService,
    private scanner: ScannerService,
    private modeService: AppModeService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.isRestaurant = this.modeService.isRestaurant();
    this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      [this.products, this.categories] = await Promise.all([
        this.db.getProducts(),
        this.db.getCategories(),
      ]);
      this.filteredProducts = [...this.products];
    } catch {
      this.error = 'Cannot reach server (localhost:8000). Start the backend: cd backend && python main.py';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  search(): void {
    const term = this.searchTerm.toLowerCase();
    this.filteredProducts = this.products.filter(p =>
      p.name.toLowerCase().includes(term) ||
      (p.sku ?? '').toLowerCase().includes(term) ||
      (p.barcode ?? '').toLowerCase().includes(term) ||
      this.categoryName(p.category_id).toLowerCase().includes(term)
    );
  }

  openAdd(): void {
    this.editingId = null;
    this.form = {
      name: '', category_id: null, sku: '', barcode: '',
      price_lkr: 0, price_usd: 0, vat_rate: 0, unit: 'pcs',
      track_stock: false, stock_quantity: -1, is_available: true,
    };
    this.lookupStatus = 'idle'; this.lookupMessage = '';
    this.showForm = true;
  }

  openEdit(p: ApiProduct): void {
    this.editingId = p.id;
    this.form = {
      name: p.name,
      category_id: p.category_id,
      sku: p.sku ?? '',
      barcode: p.barcode ?? '',
      price_lkr: p.price_lkr,
      price_usd: p.price_usd,
      vat_rate: p.vat_rate,
      unit: p.unit,
      track_stock: p.track_stock,
      stock_quantity: p.stock_quantity ?? -1,
      is_available: p.is_available,
    };
    this.lookupStatus = 'idle'; this.lookupMessage = '';
    this.showForm = true;
  }

  async saveProduct(): Promise<void> {
    if (!this.form.name.trim()) { alert('Name is required.'); return; }
    try {
      const payload: Partial<ApiProduct> = {
        name: this.form.name.trim(),
        category_id: this.form.category_id ?? undefined,
        sku: this.form.sku || null,
        barcode: this.form.barcode || null,
        price_lkr: this.form.price_lkr,
        price_usd: this.form.price_usd,
        vat_rate: this.form.vat_rate,
        unit: this.form.unit,
        track_stock: this.form.track_stock,
        stock_quantity: this.form.track_stock ? this.form.stock_quantity : -1,
        is_available: this.form.is_available,
      };
      if (this.editingId) {
        await this.db.updateProduct(this.editingId, payload);
      } else {
        await this.db.createProduct(payload);
      }
      this.showForm = false;
      await this.load();
    } catch {
      alert('Failed to save product. Make sure the backend is running.');
    }
  }

  async deleteProduct(id: number): Promise<void> {
    if (!confirm('Delete this product?')) return;
    try {
      await this.db.deleteProduct(id);
      await this.load();
    } catch {
      alert('Failed to delete product.');
    }
  }

  // ── Scan barcode with camera → fill form ──────────────────────
  async scanBarcodeForForm(): Promise<void> {
    this.scanningBarcode = true;
    const sub = this.scanner.scanResult.subscribe(async (code) => {
      sub.unsubscribe();
      this.scanningBarcode = false;
      this.form.barcode = code;
      this.cdr.detectChanges();
      await this.lookupBarcode(code);
      this.cdr.detectChanges();
    });
    await this.scanner.scanWithCamera();
    setTimeout(() => { if (this.scanningBarcode) { sub.unsubscribe(); this.scanningBarcode = false; } }, 60000);
  }

  async onBarcodeInput(): Promise<void> {
    const code = this.form.barcode.trim();
    if (code.length >= 8) await this.lookupBarcode(code);
    else { this.lookupStatus = 'idle'; this.lookupMessage = ''; }
  }

  // ── Open Food Facts lookup ─────────────────────────────────────
  async lookupBarcode(code: string): Promise<void> {
    this.lookupStatus = 'loading';
    this.lookupMessage = 'Looking up barcode...';
    this.cdr.detectChanges();
    try {
      const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
      const data = await res.json();
      if (data.status === 1 && data.product) {
        const p = data.product;
        const name = p.product_name_en || p.product_name || '';
        const brand = p.brands || '';
        if (name) {
          if (!this.form.name) this.form.name = brand ? `${brand} ${name}` : name;
          this.lookupStatus = 'found';
          this.lookupMessage = `✓ Found: ${name}${brand ? ' by ' + brand : ''}`;
        } else {
          this.lookupStatus = 'not-found';
          this.lookupMessage = 'Found but no name — fill manually.';
        }
      } else {
        this.lookupStatus = 'not-found';
        this.lookupMessage = 'Not in Open Food Facts — fill manually.';
      }
    } catch {
      this.lookupStatus = 'error';
      this.lookupMessage = 'Lookup failed (offline?) — fill manually.';
    }
    this.cdr.detectChanges();
  }
}
