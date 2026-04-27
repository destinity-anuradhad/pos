import { Component, OnInit } from '@angular/core';

interface Product {
  id: number;
  name: string;
  category: string;
  price_lkr: number;
  price_usd: number;
  barcode: string;
}

@Component({
  selector: 'app-products',
  standalone: false,
  templateUrl: './products.html',
  styleUrls: ['./products.scss']
})
export class Products implements OnInit {
  products: Product[] = [
    { id: 1, name: 'Grilled Chicken', category: 'Main Course', price_lkr: 1800, price_usd: 6.00, barcode: '1001' },
    { id: 2, name: 'Fried Rice', category: 'Main Course', price_lkr: 1200, price_usd: 4.00, barcode: '1002' },
    { id: 3, name: 'Caesar Salad', category: 'Salads', price_lkr: 900, price_usd: 3.00, barcode: '1003' },
    { id: 4, name: 'Coca Cola', category: 'Beverages', price_lkr: 300, price_usd: 1.00, barcode: '1004' },
    { id: 5, name: 'Chocolate Cake', category: 'Desserts', price_lkr: 750, price_usd: 2.50, barcode: '1005' },
  ];

  filteredProducts: Product[] = [];
  searchTerm = '';
  showForm = false;
  editingProduct: Product | null = null;

  form = { name: '', category: '', price_lkr: 0, price_usd: 0, barcode: '' };

  categories = ['Main Course', 'Salads', 'Beverages', 'Desserts', 'Starters'];

  ngOnInit(): void {
    this.filteredProducts = [...this.products];
  }

  search(): void {
    const term = this.searchTerm.toLowerCase();
    this.filteredProducts = this.products.filter(p =>
      p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term)
    );
  }

  openAdd(): void {
    this.editingProduct = null;
    this.form = { name: '', category: '', price_lkr: 0, price_usd: 0, barcode: '' };
    this.showForm = true;
  }

  openEdit(p: Product): void {
    this.editingProduct = p;
    this.form = { name: p.name, category: p.category, price_lkr: p.price_lkr, price_usd: p.price_usd, barcode: p.barcode };
    this.showForm = true;
  }

  saveProduct(): void {
    if (this.editingProduct) {
      Object.assign(this.editingProduct, this.form);
    } else {
      this.products.push({ id: Date.now(), ...this.form });
    }
    this.filteredProducts = [...this.products];
    this.showForm = false;
  }

  deleteProduct(id: number): void {
    if (!confirm('Delete this product?')) return;
    this.products = this.products.filter(p => p.id !== id);
    this.filteredProducts = [...this.products];
  }
}
