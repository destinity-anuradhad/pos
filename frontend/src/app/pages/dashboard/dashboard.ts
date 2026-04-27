import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ApiOrder } from '../../services/api';
import { DatabaseService } from '../../services/database';
import { AppModeService } from '../../services/app-mode';

@Component({
  selector: 'app-dashboard',
  standalone: false,
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class Dashboard implements OnInit {
  today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  isRestaurant = false;
  loading = true;
  isOnline = navigator.onLine;

  salesLkr = 0;
  salesUsd = 0;
  orderCount = 0;
  activeTables = 0;
  avgOrderLkr = 0;

  recentOrders: ApiOrder[] = [];

  constructor(private db: DatabaseService, private modeService: AppModeService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.isRestaurant = this.modeService.isRestaurant();
    window.addEventListener('online',  () => { this.isOnline = true;  this.load(); });
    window.addEventListener('offline', () => { this.isOnline = false; });
    this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const [stats, orders] = await Promise.all([
        this.db.getOrderStats(),
        this.db.getOrders(0, 5),
      ]);
      this.salesLkr     = stats.sales_lkr;
      this.salesUsd     = stats.sales_usd;
      this.orderCount   = stats.order_count;
      this.activeTables = stats.active_tables;
      this.avgOrderLkr  = stats.avg_order_lkr;
      this.recentOrders = orders;
    } catch {
      // Backend offline — show zeros, not fake data
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  timeAgo(iso: string): string {
    if (!iso) return '';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }
}
