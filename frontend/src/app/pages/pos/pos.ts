import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppModeService } from '../../services/app-mode';
import { ScannerService } from '../../services/scanner';
import { CustomerDisplayService } from '../../services/customer-display';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts';

interface Product { id: number; name: string; category: string; price_lkr: number; price_usd: number; barcode: string; }
interface CartItem extends Product { quantity: number; }
interface Table { id: number; name: string; status: string; }

@Component({
  selector: 'app-pos',
  standalone: false,
  templateUrl: './pos.html',
  styleUrls: ['./pos.scss']
})
export class Pos implements OnInit, OnDestroy {
  isRestaurant = false;
  isMobile = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.();

  tables: Table[] = [
    { id: 1, name: 'Table 1', status: 'available' },
    { id: 2, name: 'Table 2', status: 'occupied' },
    { id: 3, name: 'Table 3', status: 'available' },
    { id: 4, name: 'Table 4', status: 'billed' },
    { id: 5, name: 'Table 5', status: 'available' },
    { id: 6, name: 'Table 6', status: 'occupied' },
    { id: 7, name: 'Table 7', status: 'available' },
    { id: 8, name: 'Table 8', status: 'available' },
  ];

  products: Product[] = [
    { id: 1, name: 'Grilled Chicken', category: 'Main Course', price_lkr: 1800, price_usd: 6.00, barcode: '1001' },
    { id: 2, name: 'Fried Rice', category: 'Main Course', price_lkr: 1200, price_usd: 4.00, barcode: '1002' },
    { id: 3, name: 'Caesar Salad', category: 'Salads', price_lkr: 900, price_usd: 3.00, barcode: '1003' },
    { id: 4, name: 'Coca Cola', category: 'Beverages', price_lkr: 300, price_usd: 1.00, barcode: '1004' },
    { id: 5, name: 'Chocolate Cake', category: 'Desserts', price_lkr: 750, price_usd: 2.50, barcode: '1005' },
    { id: 6, name: 'Garlic Bread', category: 'Starters', price_lkr: 450, price_usd: 1.50, barcode: '1006' },
    { id: 7, name: 'Mango Juice', category: 'Beverages', price_lkr: 400, price_usd: 1.25, barcode: '1007' },
    { id: 8, name: 'Pasta', category: 'Main Course', price_lkr: 1500, price_usd: 5.00, barcode: '1008' },
  ];

  filteredProducts: Product[] = [];
  cart: CartItem[] = [];
  selectedTable: Table | null = null;
  currency: 'LKR' | 'USD' = 'LKR';
  searchTerm = '';
  step: 'tables' | 'order' | 'receipt' = 'tables';
  lastOrderId = 0;
  today = new Date().toLocaleString();

  categories: string[] = [];
  selectedCategory = 'All';

  private scanSub!: Subscription;
  private shortcutSub!: Subscription;
  scanMessage = '';
  manualBarcode = '';

  constructor(
    private modeService: AppModeService,
    private scanner: ScannerService,
    private displayService: CustomerDisplayService,
    private shortcuts: KeyboardShortcutsService
  ) {}

  ngOnInit(): void {
    this.isRestaurant = this.modeService.isRestaurant();
    this.filteredProducts = [...this.products];
    this.categories = ['All', ...new Set(this.products.map(p => p.category))];
    // Retail: skip table selection
    if (!this.isRestaurant) {
      this.step = 'order';
      this.selectedTable = null;
    }

    this.scanner.startKeyboardListener();
    this.scanSub = this.scanner.scanResult.subscribe(code => {
      const product = this.products.find(p => p.barcode && String(p.barcode) === code);
      if (product) {
        this.addToCart(product as any);
        this.scanMessage = `✓ Added: ${product.name}`;
      } else {
        this.scanMessage = `✗ Product not found: ${code}`;
      }
      setTimeout(() => this.scanMessage = '', 2500);
    });

    this.shortcutSub = this.shortcuts.action.subscribe(action => {
      if (action === 'search' && this.step === 'order') {
        document.querySelector<HTMLInputElement>('.scan-input')?.focus();
      }
      if (action === 'checkout' && this.step === 'order') this.checkout();
      if (action === 'newOrder') this.newOrder();
    });
  }

  ngOnDestroy(): void {
    this.scanner.stopKeyboardListener();
    this.scanSub?.unsubscribe();
    this.shortcutSub?.unsubscribe();
  }

  manualScan(): void {
    if (this.manualBarcode) {
      this.scanner.emitScan(this.manualBarcode);
      this.manualBarcode = '';
    }
  }

  async openCamera(): Promise<void> {
    await this.scanner.scanWithCamera();
  }

  private sendToDisplay(): void {
    this.displayService.send({
      items: this.cart.map(i => ({ name: i.name, qty: i.quantity, price: this.getPrice(i) })),
      total: this.getTotal(),
      currency: this.currency,
      status: this.step === 'receipt' ? 'checkout' : this.cart.length > 0 ? 'ordering' : 'idle'
    });
  }

  selectTable(table: Table): void {
    if (table.status === 'billed') return;
    this.selectedTable = table;
    this.cart = [];
    this.step = 'order';
  }

  filterCategory(cat: string): void {
    this.selectedCategory = cat;
    this.filterProducts();
  }

  filterProducts(): void {
    let list = this.products;
    if (this.selectedCategory !== 'All') list = list.filter(p => p.category === this.selectedCategory);
    if (this.searchTerm) list = list.filter(p => p.name.toLowerCase().includes(this.searchTerm.toLowerCase()));
    this.filteredProducts = list;
  }

  addToCart(product: Product): void {
    const existing = this.cart.find(i => i.id === product.id);
    if (existing) existing.quantity++;
    else this.cart.push({ ...product, quantity: 1 });
    this.sendToDisplay();
  }

  removeFromCart(id: number): void {
    this.cart = this.cart.filter(i => i.id !== id);
    this.sendToDisplay();
  }

  changeQty(item: CartItem, delta: number): void {
    item.quantity += delta;
    if (item.quantity <= 0) this.removeFromCart(item.id);
    else this.sendToDisplay();
  }

  getPrice(p: Product): number {
    return this.currency === 'LKR' ? p.price_lkr : p.price_usd;
  }

  getTotal(): number {
    return this.cart.reduce((sum, i) => sum + this.getPrice(i) * i.quantity, 0);
  }

  checkout(): void {
    if (this.cart.length === 0) return;
    this.lastOrderId = Math.floor(1000 + Math.random() * 9000);
    if (this.selectedTable) this.selectedTable.status = 'occupied';
    this.step = 'receipt';
    this.sendToDisplay();
  }

  newOrder(): void {
    this.cart = [];
    if (this.isRestaurant) {
      this.step = 'tables';
      this.selectedTable = null;
    } else {
      this.step = 'order';
    }
    this.sendToDisplay();
  }

  get orderTitle(): string {
    if (this.isRestaurant && this.selectedTable) return `New Order — ${this.selectedTable.name}`;
    return 'New Sale';
  }
}
