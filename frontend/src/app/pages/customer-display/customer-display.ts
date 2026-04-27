import { Component, OnInit } from '@angular/core';
import { CustomerDisplayService, DisplayData } from '../../services/customer-display';

@Component({
  selector: 'app-customer-display',
  templateUrl: './customer-display.html',
  styleUrls: ['./customer-display.scss'],
  standalone: false
})
export class CustomerDisplay implements OnInit {
  data: DisplayData = {
    items: [],
    total: 0,
    currency: 'LKR',
    status: 'idle'
  };

  time = '';

  constructor(private displayService: CustomerDisplayService) {}

  ngOnInit(): void {
    const last = this.displayService.getLastData();
    if (last) this.data = last;
    this.displayService.onMessage(d => this.data = d);
    setInterval(() => {
      this.time = new Date().toLocaleTimeString();
    }, 1000);
  }
}
