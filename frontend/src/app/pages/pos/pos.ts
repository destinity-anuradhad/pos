import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppModeService } from '../../services/app-mode';
import { ScannerService } from '../../services/scanner';
import { CustomerDisplayService } from '../../services/customer-display';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts';
import { ApiProduct, ApiTable } from '../../services/api';
import { DatabaseService } from '../../services/database';

interface CartItem extends ApiProduct { quantity: number; }

interface CardDetails {
  name: string;
  number: string;
  expiry: string;
  cvv: string;
}

@Component({
  selector: 'app-pos',
  standalone: false,
  templateUrl: './pos.html',
  styleUrls: ['./pos.scss']
})
export class Pos implements OnInit, OnDestroy {
  isRestaurant = false;
  isMobile = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.();

  tables: ApiTable[] = [];
  products: ApiProduct[] = [];
  filteredProducts: ApiProduct[] = [];
  cart: CartItem[] = [];
  selectedTable: ApiTable | null = null;
  currency: 'LKR' | 'USD' = 'LKR';
  searchTerm = '';
  step: 'tables' | 'order' | 'receipt' = 'tables';
  lastOrderId = 0;
  today = new Date().toLocaleString();

  categories: string[] = [];
  selectedCategory = 'All';

  loadingProducts = true;
  loadingTables = true;
  checkingOut = false;
  error = '';
  mobileTab: 'products' | 'cart' = 'products';

  // Payment flow
  paymentModal: 'closed' | 'method' | 'card' = 'closed';
  paymentMethod: 'cash' | 'card' | null = null;
  card: CardDetails = { name: '', number: '', expiry: '', cvv: '' };
  cardError = '';

  private scanSub!: Subscription;
  private shortcutSub!: Subscription;
  private unsubPing?: () => void;
  scanMessage = '';
  manualBarcode = '';

  constructor(
    private modeService: AppModeService,
    private scanner: ScannerService,
    private displayService: CustomerDisplayService,
    private shortcuts: KeyboardShortcutsService,
    private db: DatabaseService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.isRestaurant = this.modeService.isRestaurant();

    if (!this.isRestaurant) {
      this.step = 'order';
      this.selectedTable = null;
    }

    this.loadProducts();
    if (this.isRestaurant) this.loadTables();

    this.sendToDisplay();
    this.unsubPing = this.displayService.onPing(() => this.sendToDisplay());

    this.scanner.startKeyboardListener();
    this.scanSub = this.scanner.scanResult.subscribe(code => {
      const product = this.products.find(p => p.barcode && String(p.barcode) === code);
      if (product) {
        this.addToCart(product);
        this.scanMessage = `✓ Added: ${product.name}`;
      } else {
        this.scanMessage = `✗ Product not found: ${code}`;
      }
      this.cdr.detectChanges();
      setTimeout(() => { this.scanMessage = ''; this.cdr.detectChanges(); }, 2500);
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
    this.unsubPing?.();
    this.displayService.send({ items: [], total: 0, currency: this.currency, status: 'idle' });
  }

  async loadProducts(): Promise<void> {
    this.loadingProducts = true;
    this.error = '';
    try {
      this.products = await this.db.getProducts();
      this.categories = ['All', ...new Set(this.products.map(p => p.category))];
      this.filterProducts();
    } catch {
      this.error = 'Cannot reach server (localhost:8000). Start the backend: cd backend && python main.py';
    } finally {
      this.loadingProducts = false;
      this.cdr.detectChanges();
    }
  }

  async loadTables(): Promise<void> {
    this.loadingTables = true;
    try {
      this.tables = await this.db.getTables();
    } catch {
      // silent — table grid will just be empty
    } finally {
      this.loadingTables = false;
      this.cdr.detectChanges();
    }
  }

  manualScan(input?: HTMLInputElement): void {
    const code = (input?.value ?? this.manualBarcode).trim();
    this.manualBarcode = '';
    if (input) input.value = '';
    if (code) this.scanner.emitScan(code);
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

  goToTables(): void {
    if (this.selectedTable) {
      this.db.updateTableStatus(this.selectedTable.id, 'available').catch(() => {});
      const t = this.tables.find(t => t.id === this.selectedTable!.id);
      if (t) t.status = 'available';
    }
    this.step = 'tables';
    this.selectedTable = null;
    this.cart = [];
    this.displayService.send({ items: [], total: 0, currency: this.currency, status: 'idle' });
  }

  selectTable(table: ApiTable): void {
    if (table.status === 'billed') return;
    this.selectedTable = table;
    this.cart = [];
    this.step = 'order';
    this.db.updateTableStatus(table.id, 'occupied').then(() => {
      table.status = 'occupied';
    }).catch(() => {});
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

  addToCart(product: ApiProduct): void {
    const existing = this.cart.find(i => i.id === product.id);
    if (existing) existing.quantity++;
    else this.cart.push({ ...product, quantity: 1 });
    this.mobileTab = 'cart';
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

  getPrice(p: ApiProduct): number {
    return this.currency === 'LKR' ? p.price_lkr : p.price_usd;
  }

  getTotal(): number {
    return this.cart.reduce((sum, i) => sum + this.getPrice(i) * i.quantity, 0);
  }

  // Step 1: open payment method picker
  openPayment(): void {
    if (this.cart.length === 0 || this.checkingOut) return;
    this.paymentModal = 'method';
    this.paymentMethod = null;
    this.card = { name: '', number: '', expiry: '', cvv: '' };
    this.cardError = '';
    this.cdr.detectChanges();
  }

  // Step 2a: user chose cash → go straight to checkout
  selectCash(): void {
    this.paymentMethod = 'cash';
    this.paymentModal = 'closed';
    this.checkout();
  }

  // Step 2b: user chose card → show card form
  selectCard(): void {
    this.paymentMethod = 'card';
    this.paymentModal = 'card';
    this.cardError = '';
    this.cdr.detectChanges();
  }

  // Step 3: validate card details then checkout
  submitCard(): void {
    const num = this.card.number.replace(/\s/g, '');
    if (!this.card.name.trim()) { this.cardError = 'Cardholder name is required.'; return; }
    if (num.length < 13 || num.length > 19 || !/^\d+$/.test(num)) { this.cardError = 'Enter a valid card number.'; return; }
    if (!/^\d{2}\/\d{2}$/.test(this.card.expiry)) { this.cardError = 'Expiry must be MM/YY.'; return; }
    if (!/^\d{3,4}$/.test(this.card.cvv)) { this.cardError = 'CVV must be 3 or 4 digits.'; return; }
    this.cardError = '';
    this.paymentModal = 'closed';
    this.checkout();
  }

  closePaymentModal(): void {
    this.paymentModal = 'closed';
    this.cdr.detectChanges();
  }

  // Format card number with spaces every 4 digits
  formatCardNumber(e: Event): void {
    const input = e.target as HTMLInputElement;
    let v = input.value.replace(/\D/g, '').slice(0, 16);
    input.value = v.replace(/(.{4})/g, '$1 ').trim();
    this.card.number = input.value;
  }

  // Format expiry as MM/YY
  formatExpiry(e: Event): void {
    const input = e.target as HTMLInputElement;
    let v = input.value.replace(/\D/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    input.value = v;
    this.card.expiry = v;
  }

  async checkout(): Promise<void> {
    if (this.cart.length === 0 || this.checkingOut) return;
    this.checkingOut = true;
    this.today = new Date().toLocaleString();
    try {
      const order = await this.db.createOrder({
        table_id: this.selectedTable?.id ?? null,
        currency: this.currency,
        total_amount: this.getTotal(),
        items: this.cart.map(i => ({
          product_id: i.id,
          quantity: i.quantity,
          unit_price: this.getPrice(i),
          subtotal: this.getPrice(i) * i.quantity,
        }))
      });
      this.lastOrderId = order.id;
      if (this.selectedTable) {
        const t = this.tables.find(t => t.id === this.selectedTable!.id);
        if (t) t.status = 'billed';
        this.selectedTable.status = 'billed';
      }
    } catch {
      // Offline fallback: still show receipt with a local ID
      this.lastOrderId = Math.floor(1000 + Math.random() * 9000);
      if (this.selectedTable) this.selectedTable.status = 'billed';
    } finally {
      this.checkingOut = false;
    }
    this.step = 'receipt';
    this.sendToDisplay();
    this.cdr.detectChanges();
  }

  newOrder(): void {
    this.cart = [];
    if (this.isRestaurant) {
      this.loadTables();
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
