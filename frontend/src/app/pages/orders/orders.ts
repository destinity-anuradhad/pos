import { Component, OnInit } from '@angular/core';

interface Order {
  id: number;
  table: string;
  items: number;
  currency: string;
  total: number;
  status: string;
  date: string;
}

@Component({
  selector: 'app-orders',
  standalone: false,
  templateUrl: './orders.html',
  styleUrls: ['./orders.scss']
})
export class Orders implements OnInit {
  orders: Order[] = [
    { id: 1024, table: 'Table 3', items: 4, currency: 'LKR', total: 3450, status: 'completed', date: '2026-04-27 14:32' },
    { id: 1023, table: 'Table 7', items: 2, currency: 'USD', total: 12.50, status: 'completed', date: '2026-04-27 14:25' },
    { id: 1022, table: 'Table 1', items: 3, currency: 'LKR', total: 2100, status: 'pending', date: '2026-04-27 14:18' },
    { id: 1021, table: 'Table 5', items: 5, currency: 'LKR', total: 5800, status: 'completed', date: '2026-04-27 14:05' },
    { id: 1020, table: 'Table 2', items: 2, currency: 'USD', total: 8.00, status: 'completed', date: '2026-04-27 13:59' },
    { id: 1019, table: 'Table 4', items: 6, currency: 'LKR', total: 7200, status: 'cancelled', date: '2026-04-27 13:45' },
    { id: 1018, table: 'Table 6', items: 3, currency: 'LKR', total: 4100, status: 'completed', date: '2026-04-27 13:30' },
  ];

  filteredOrders: Order[] = [];
  filterStatus = 'all';
  searchTerm = '';

  ngOnInit(): void {
    this.filteredOrders = [...this.orders];
  }

  applyFilter(): void {
    this.filteredOrders = this.orders.filter(o => {
      const matchStatus = this.filterStatus === 'all' || o.status === this.filterStatus;
      const matchSearch = !this.searchTerm || o.table.toLowerCase().includes(this.searchTerm.toLowerCase()) || String(o.id).includes(this.searchTerm);
      return matchStatus && matchSearch;
    });
  }
}
