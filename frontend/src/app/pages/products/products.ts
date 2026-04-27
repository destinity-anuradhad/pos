import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { DatabaseService } from '../../services/database';
import { ScannerService } from '../../services/scanner';
import { AppModeService } from '../../services/app-mode';

interface Product {
  id: number; name: string; category: string;
  price_lkr: number; price_usd: number; barcode: string;
}

@Component({
  selector: 'app-products',
  standalone: false,
  templateUrl: './products.html',
  styleUrls: ['./products.scss']
})
export class Products implements OnInit {
  isRestaurant = false;
  products: Product[] = [];
  filteredProducts: Product[] = [];
  searchTerm = '';
  loading = true;
  error = '';

  showForm = false;
  editingId: number | null = null;
  form = { name: '', category: '', price_lkr: 0, price_usd: 0, barcode: '' };

  scanningBarcode = false;
  lookupStatus: 'idle' | 'loading' | 'found' | 'not-found' | 'error' = 'idle';
  lookupMessage = '';

  isMobile = typeof (window as any).Capacitor !== 'undefined' &&
             (window as any).Capacitor?.isNativePlatform?.();

  get categories(): string[] {
    const base = this.isRestaurant
      ? ['Main Course','Salads','Starters','Desserts','Beverages']
      : ['Grocery','Dairy','Beverages','Personal Care','Stationery','Snacks'];
    const extra = [...new Set(this.products.map(p => p.category))];
    return [...new Set([...base, ...extra])];
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
      const data = await this.db.getProducts();
      this.products = data.map(p => ({
        id: p.id, name: p.name, category: p.category,
        price_lkr: p.price_lkr, price_usd: p.price_usd, barcode: p.barcode,
      }));
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
      p.category.toLowerCase().includes(term) ||
      p.barcode.toLowerCase().includes(term)
    );
  }

  openAdd(): void {
    this.editingId = null;
    this.form = { name: '', category: '', price_lkr: 0, price_usd: 0, barcode: '' };
    this.lookupStatus = 'idle'; this.lookupMessage = '';
    this.showForm = true;
  }

  openEdit(p: Product): void {
    this.editingId = p.id;
    this.form = { name: p.name, category: p.category, price_lkr: p.price_lkr, price_usd: p.price_usd, barcode: p.barcode };
    this.lookupStatus = 'idle'; this.lookupMessage = '';
    this.showForm = true;
  }

  async saveProduct(): Promise<void> {
    if (!this.form.name.trim() || !this.form.barcode.trim()) {
      alert('Name and Barcode are required.'); return;
    }
    try {
      if (this.editingId) {
        await this.db.updateProduct(this.editingId, this.form);
      } else {
        await this.db.createProduct(this.form);
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
        const cat = this.mapCategory(p.categories_tags || []);
        if (name) {
          if (!this.form.name)     this.form.name     = brand ? `${brand} ${name}` : name;
          if (!this.form.category) this.form.category = cat;
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

  private mapCategory(tags: string[]): string {
    const map: Record<string, string> = {
      'beverages':'Beverages','drinks':'Beverages','waters':'Beverages',
      'snacks':'Snacks','biscuits':'Snacks','chips':'Snacks','chocolates':'Snacks',
      'dairy':'Dairy','cheeses':'Dairy','milks':'Dairy',
      'cereals':'Grocery','flours':'Grocery','oils':'Grocery','sugars':'Grocery',
      'personal-care':'Personal Care','hygiene':'Personal Care','shampoos':'Personal Care',
    };
    for (const tag of tags) {
      const key = tag.replace(/^[a-z]+:/, '').toLowerCase();
      for (const [kw, cat] of Object.entries(map)) {
        if (key.includes(kw)) return cat;
      }
    }
    return '';
  }
}
