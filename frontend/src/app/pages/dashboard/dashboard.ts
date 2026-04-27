import { Component, OnInit } from '@angular/core';

interface StatCard {
  label: string;
  value: string;
  icon: string;
  color: string;
}

interface RecentOrder {
  id: number;
  table: string;
  amount: string;
  currency: string;
  status: string;
  time: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: false,
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class Dashboard implements OnInit {
  today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  stats: StatCard[] = [
    { label: 'Today\'s Sales', value: 'LKR 48,500', icon: '💰', color: '#094f70' },
    { label: 'Orders Today', value: '24', icon: '📋', color: '#e67e22' },
    { label: 'Active Tables', value: '7', icon: '🪑', color: '#27ae60' },
    { label: 'Avg. Order', value: 'LKR 2,020', icon: '📊', color: '#8e44ad' }
  ];

  recentOrders: RecentOrder[] = [
    { id: 1024, table: 'Table 3', amount: '3,450', currency: 'LKR', status: 'completed', time: '2 min ago' },
    { id: 1023, table: 'Table 7', amount: '12.50', currency: 'USD', status: 'completed', time: '8 min ago' },
    { id: 1022, table: 'Table 1', amount: '2,100', currency: 'LKR', status: 'pending', time: '12 min ago' },
    { id: 1021, table: 'Table 5', amount: '5,800', currency: 'LKR', status: 'completed', time: '25 min ago' },
    { id: 1020, table: 'Table 2', amount: '8.00', currency: 'USD', status: 'completed', time: '31 min ago' },
  ];

  ngOnInit(): void {}
}
