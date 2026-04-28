import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ApiOrder } from '../../services/api';
import { DatabaseService } from '../../services/database';

@Component({
  selector: 'app-orders',
  standalone: false,
  templateUrl: './orders.html',
  styleUrls: ['./orders.scss']
})
export class Orders implements OnInit {
  allOrders: ApiOrder[] = [];
  filteredOrders: ApiOrder[] = [];
  filterStatus = 'all';
  searchTerm = '';
  loading = true;
  error = '';

  constructor(private db: DatabaseService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.allOrders = await this.db.getOrders(0, 100);
      this.applyFilter();
    } catch {
      this.error = 'Cannot reach server (localhost:8000). Start the backend: cd backend && python main.py';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  applyFilter(): void {
    const term = this.searchTerm.toLowerCase();
    this.filteredOrders = this.allOrders.filter(o => {
      const matchStatus = this.filterStatus === 'all' || o.status === this.filterStatus;
      const matchSearch = !term ||
        o.table_name.toLowerCase().includes(term) ||
        String(o.id).includes(term);
      return matchStatus && matchSearch;
    });
  }

  timeAgo(iso: string): string {
    if (!iso) return '';
    // Backend stores UTC without timezone suffix — append Z so JS parses as UTC
    const utc = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
    const diff = Math.floor((Date.now() - new Date(utc).getTime()) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(utc).toLocaleDateString();
  }
}
