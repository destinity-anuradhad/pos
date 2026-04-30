import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { ScannerService } from '../../services/scanner';
import { CustomerDisplayService } from '../../services/customer-display';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts';
import { ApiProduct, ApiTable, ApiCategory, ApiOrder } from '../../services/api';
import { DatabaseService } from '../../services/database';
import { ApiService } from '../../services/api';
import { TerminalService } from '../../services/terminal';
import { SyncService } from '../../services/sync';

interface CartItem extends ApiProduct { quantity: number; }

interface CardDetails {
  name: string; number: string; expiry: string; cvv: string;
}

@Component({
  selector: 'app-pos',
  standalone: false,
  templateUrl: './pos.html',
  styleUrls: ['./pos.scss']
})
export class Pos implements OnInit, OnDestroy {
  isMobile = true; // camera button shown on all platforms — scanWithCamera() handles BarcodeDetector (Chromium/Electron) and html5-qrcode fallback automatically

  tables: ApiTable[] = [];
  products: ApiProduct[] = [];
  filteredProducts: ApiProduct[] = [];
  categories: ApiCategory[] = [];
  cart: CartItem[] = [];
  selectedTable: ApiTable | null = null;
  currency: 'LKR' | 'USD' = 'LKR';
  searchTerm = '';
  step: 'tables' | 'order' | 'receipt' = 'tables';
  lastOrder: ApiOrder | null = null;
  lastOrderRef  = '';
  lastOrderId   = 0;
  today = new Date().toLocaleString();

  selectedCategoryId: number | null = null;  // null = All

  loadingProducts = true;
  loadingTables   = true;
  checkingOut     = false;
  error           = '';
  mobileTab: 'products' | 'cart' = 'products';

  // Payment
  paymentModal: 'closed' | 'method' | 'cash' | 'card' = 'closed';
  paymentMethod: 'cash' | 'card' | null = null;
  cashTendered = 0;
  cashChange   = 0;
  card: CardDetails = { name: '', number: '', expiry: '', cvv: '' };
  cardError = '';

  private scanSub!: Subscription;
  private shortcutSub!: Subscription;
  private unsubPing?: () => void;
  scanMessage  = '';
  manualBarcode = '';

  constructor(
    private scanner: ScannerService,
    private displayService: CustomerDisplayService,
    private shortcuts: KeyboardShortcutsService,
    private db: DatabaseService,
    private api: ApiService,
    private terminal: TerminalService,
    private sync: SyncService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadProducts();
    this.loadTables();
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
      if (action === 'search' && this.step === 'order')
        document.querySelector<HTMLInputElement>('.scan-input')?.focus();
      if (action === 'checkout' && this.step === 'order') this.openPayment();
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
      [this.products, this.categories] = await Promise.all([
        this.db.getProducts(),
        this.db.getCategories(),
      ]);
      // Only show available products in POS
      this.products = this.products.filter(p => p.is_available !== false);
      this.filterProducts();
    } catch {
      this.error = 'Cannot reach server. Make sure the backend is running.';
    } finally {
      this.loadingProducts = false;
      this.cdr.detectChanges();
    }
  }

  async loadTables(): Promise<void> {
    this.loadingTables = true;
    try {
      this.tables = await this.db.getTables();
      // Only show active tables
      this.tables = this.tables.filter(t => t.is_active !== false);
    } catch {
      // silent
    } finally {
      this.loadingTables = false;
      this.cdr.detectChanges();
    }
  }

  // ── Add table modal ────────────────────────────────────────────────────────

  showAddTable = false;
  newTableName = '';
  newTableCapacity = 4;
  savingTable = false;

  openAddTable(): void {
    this.newTableName     = '';
    this.newTableCapacity = 4;
    this.showAddTable     = true;
  }

  async saveTable(): Promise<void> {
    if (!this.newTableName.trim()) return;
    this.savingTable = true;
    try {
      await this.db.createTable({ name: this.newTableName.trim(), capacity: this.newTableCapacity });
      this.showAddTable = false;
      await this.loadTables();
    } catch {
      alert('Failed to create table.');
    } finally {
      this.savingTable = false;
      this.cdr.detectChanges();
    }
  }

  // ── Table selection ────────────────────────────────────────────────────────

  canSelectTable(table: ApiTable): boolean {
    return !['billed', 'cleaning'].includes(table.status_code || '');
  }

  selectTable(table: ApiTable): void {
    if (!this.canSelectTable(table)) return;
    this.selectedTable = table;
    this.cart = [];
    this.step = 'order';

    // Transition: Available/Reserved → Seated (manual staff action)
    if (['available', 'reserved'].includes(table.status_code || '')) {
      this.db.updateTableStatus(table.id, 'seated').then(updated => {
        const t = this.tables.find(t => t.id === table.id);
        if (t && updated) {
          t.status_code  = updated.status_code;
          t.status_label = updated.status_label;
          t.status_color = updated.status_color;
        }
        if (this.selectedTable && updated) {
          this.selectedTable.status_code  = updated.status_code;
          this.selectedTable.status_label = updated.status_label;
          this.selectedTable.status_color = updated.status_color;
        }
      }).catch(() => {});
    }
  }

  goToTables(): void {
    this.step = 'tables';
    this.selectedTable = null;
    this.cart = [];
    this.loadTables();
    this.displayService.send({ items: [], total: 0, currency: this.currency, status: 'idle' });
  }

  async changeTableStatus(table: ApiTable, toCode: string, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      const updated = await this.db.updateTableStatus(table.id, toCode);
      table.status_code       = updated.status_code;
      table.status_label      = updated.status_label;
      table.status_color      = updated.status_color;
      table.allowed_transitions = updated.allowed_transitions;
      this.cdr.detectChanges();
    } catch (e: any) {
      alert(e?.message || 'Status change failed');
    }
  }

  // ── Products / cart ────────────────────────────────────────────────────────

  manualScan(input?: HTMLInputElement): void {
    const code = (input?.value ?? this.manualBarcode).trim();
    this.manualBarcode = '';
    if (input) input.value = '';
    if (code) this.scanner.emitScan(code);
  }

  async openCamera(): Promise<void> { await this.scanner.scanWithCamera(); }

  filterCategory(catId: number | null): void {
    this.selectedCategoryId = catId;
    this.filterProducts();
  }

  filterProducts(): void {
    let list = this.products;
    if (this.selectedCategoryId !== null)
      list = list.filter(p => p.category_id === this.selectedCategoryId);
    if (this.searchTerm)
      list = list.filter(p => p.name.toLowerCase().includes(this.searchTerm.toLowerCase()));
    this.filteredProducts = list;
  }

  isOutOfStock(product: ApiProduct): boolean {
    return product.track_stock && product.stock_quantity <= 0;
  }

  getStockInCart(productId: number): number {
    return this.cart.find(i => i.id === productId)?.quantity ?? 0;
  }

  canAddToCart(product: ApiProduct): boolean {
    if (!product.is_available) return false;
    if (!product.track_stock) return true;
    const inCart = this.getStockInCart(product.id);
    return product.stock_quantity - inCart > 0;
  }

  addToCart(product: ApiProduct): void {
    if (!this.canAddToCart(product)) {
      this.scanMessage = `✗ ${!product.is_available ? 'Unavailable' : 'Out of stock'}: ${product.name}`;
      setTimeout(() => { this.scanMessage = ''; this.cdr.detectChanges(); }, 2500);
      this.cdr.detectChanges();
      return;
    }

    // Transition: Seated → Ordered (first item added — auto)
    if (this.selectedTable && this.selectedTable.status_code === 'seated' && this.cart.length === 0) {
      this.db.updateTableStatus(this.selectedTable.id, 'ordered').then(updated => {
        if (this.selectedTable && updated) {
          this.selectedTable.status_code  = updated.status_code;
          this.selectedTable.status_label = updated.status_label;
          this.selectedTable.status_color = updated.status_color;
        }
      }).catch(() => {});
    }

    const existing = this.cart.find(i => i.id === product.id);
    if (existing) existing.quantity++;
    else this.cart.push({ ...product, quantity: 1 });
    this.mobileTab = 'cart';
    this.sendToDisplay();
  }

  removeFromCart(id: number): void { this.cart = this.cart.filter(i => i.id !== id); this.sendToDisplay(); }

  changeQty(item: CartItem, delta: number): void {
    if (delta > 0 && !this.canAddToCart(item)) return;
    item.quantity += delta;
    if (item.quantity <= 0) this.removeFromCart(item.id);
    else this.sendToDisplay();
  }

  getPrice(p: ApiProduct): number { return this.currency === 'LKR' ? p.price_lkr : p.price_usd; }

  getSubtotal(): number { return this.cart.reduce((s, i) => s + this.getPrice(i) * i.quantity, 0); }

  getTaxAmount(): number {
    return this.cart.reduce((s, i) => s + (this.getPrice(i) * i.quantity * (i.vat_rate || 0) / 100), 0);
  }

  getTotal(): number { return this.getSubtotal() + this.getTaxAmount(); }

  private sendToDisplay(): void {
    this.displayService.send({
      items: this.cart.map(i => ({ name: i.name, qty: i.quantity, price: this.getPrice(i) })),
      total: this.getTotal(),
      currency: this.currency,
      status: this.step === 'receipt' ? 'checkout' : this.cart.length > 0 ? 'ordering' : 'idle'
    });
  }

  // ── Payment ────────────────────────────────────────────────────────────────

  openPayment(): void {
    if (this.cart.length === 0 || this.checkingOut) return;
    this.paymentModal  = 'method';
    this.paymentMethod = null;
    this.cashTendered  = Math.ceil(this.getTotal() / 10) * 10;  // Round up to nearest 10
    this.cashChange    = 0;
    this.card          = { name: '', number: '', expiry: '', cvv: '' };
    this.cardError     = '';
    this.cdr.detectChanges();
  }

  selectCash(): void {
    this.paymentMethod = 'cash';
    this.cashTendered  = Math.ceil(this.getTotal() / 10) * 10;
    this.updateCashChange();
    this.paymentModal  = 'cash';
    this.cdr.detectChanges();
  }

  updateCashChange(): void {
    this.cashChange = Math.max(0, this.cashTendered - this.getTotal());
  }

  confirmCash(): void {
    if (this.cashTendered < this.getTotal()) {
      alert('Cash tendered must be at least ' + this.currency + ' ' + this.getTotal().toFixed(2));
      return;
    }
    this.paymentModal = 'closed';
    this.checkout();
  }

  selectCard(): void { this.paymentMethod = 'card'; this.paymentModal = 'card'; this.cardError = ''; this.cdr.detectChanges(); }

  submitCard(): void {
    const num = this.card.number.replace(/\s/g, '');
    if (!this.card.name.trim())                                    { this.cardError = 'Cardholder name is required.'; return; }
    if (num.length < 13 || num.length > 19 || !/^\d+$/.test(num)) { this.cardError = 'Enter a valid card number.'; return; }
    if (!/^\d{2}\/\d{2}$/.test(this.card.expiry))                 { this.cardError = 'Expiry must be MM/YY.'; return; }
    if (!/^\d{3,4}$/.test(this.card.cvv))                         { this.cardError = 'CVV must be 3 or 4 digits.'; return; }
    this.cardError = '';
    this.paymentModal = 'closed';
    this.checkout();
  }

  closePaymentModal(): void { this.paymentModal = 'closed'; this.cdr.detectChanges(); }

  formatCardNumber(e: Event): void {
    const input = e.target as HTMLInputElement;
    let v = input.value.replace(/\D/g, '').slice(0, 16);
    input.value = v.replace(/(.{4})/g, '$1 ').trim();
    this.card.number = input.value;
  }

  formatExpiry(e: Event): void {
    const input = e.target as HTMLInputElement;
    let v = input.value.replace(/\D/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    input.value = v;
    this.card.expiry = v;
  }

  // ── Checkout ───────────────────────────────────────────────────────────────

  async checkout(): Promise<void> {
    if (this.cart.length === 0 || this.checkingOut) return;
    this.checkingOut = true;
    this.today = new Date().toLocaleString();

    const total = this.getTotal();
    const paidAmount = this.paymentMethod === 'cash' ? this.cashTendered : total;
    const changeAmount = Math.max(0, paidAmount - total);

    try {
      // 1. Create order
      const order = await this.db.createOrder({
        table_id:      this.selectedTable?.id ?? null,
        currency:      this.currency,
        items: this.cart.map(i => ({
          product_id:    i.id,
          product_uuid:  i.uuid,
          product_name:  i.name,
          product_sku:   i.sku ?? null,
          quantity:      i.quantity,
          unit_price:    this.getPrice(i),
          vat_rate:      i.vat_rate ?? 0,
        }))
      });

      // 2. Record payment
      const cardLast4 = this.paymentMethod === 'card'
        ? this.card.number.replace(/\s/g, '').slice(-4) : undefined;
      await this.db.addPayment(order.id, {
        payment_method: this.paymentMethod!,
        amount:   paidAmount,
        currency: this.currency,
        ...(cardLast4 ? { card_last4: cardLast4, card_brand: 'card' } : {}),
      });

      // 3. Complete the order
      const completed = await this.db.completeOrder(order.id);
      this.lastOrder  = { ...completed, paid_amount: paidAmount, change_amount: changeAmount };
      this.lastOrderRef = completed.terminal_order_ref || `#${completed.id}`;
      this.lastOrderId  = completed.id;

      // Update local table status: Ordered → Billed
      if (this.selectedTable) {
        this.db.updateTableStatus(this.selectedTable.id, 'billed').then(updated => {
          const t = this.tables.find(t => t.id === this.selectedTable!.id);
          if (t && updated) {
            t.status_code  = updated.status_code;
            t.status_label = updated.status_label;
            t.status_color = updated.status_color;
          }
          if (this.selectedTable && updated) {
            this.selectedTable.status_code = updated.status_code;
          }
        }).catch(() => {});
      }

    } catch {
      // Offline fallback — queue locally
      const terminalCode = this.terminal.getTerminalCode();
      const seq  = Date.now();
      const ref  = terminalCode ? `${terminalCode}-OFFLINE-${seq}` : `OFFLINE-${seq}`;
      this.lastOrderRef = ref;
      this.lastOrderId  = seq;
      this.lastOrder    = null;

      this.sync.addPendingOrder({
        terminal_order_ref: ref,
        table_id:           this.selectedTable?.id ?? null,
        currency:           this.currency,
        total_amount:       total,
        paid_amount:        paidAmount,
        change_amount:      changeAmount,
        payment_method:     this.paymentMethod,
        items: this.cart.map(i => ({
          product_id:   i.id,
          product_uuid: i.uuid,
          product_name: i.name,
          product_sku:  i.sku ?? null,
          quantity:     i.quantity,
          unit_price:   this.getPrice(i),
          vat_rate:     i.vat_rate ?? 0,
        })),
      });

      if (this.selectedTable) {
        this.selectedTable.status_code  = 'billed';
        this.selectedTable.status_label = 'Billed';
        this.selectedTable.status_color = '#ef4444';
      }
    } finally {
      this.checkingOut = false;
    }

    this.step = 'receipt';
    this.sendToDisplay();
    this.cdr.detectChanges();
  }

  newOrder(): void {
    this.cart = [];
    this.lastOrder = null;
    this.loadTables();
    this.step = 'tables';
    this.selectedTable = null;
    this.sendToDisplay();
  }

  get orderTitle(): string {
    if (this.selectedTable) return `New Order — ${this.selectedTable.name}`;
    return 'New Sale';
  }
}
