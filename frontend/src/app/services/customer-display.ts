import { Injectable } from '@angular/core';

export interface DisplayData {
  items: { name: string; qty: number; price: number }[];
  total: number;
  currency: string;
  status: 'idle' | 'ordering' | 'checkout';
}

@Injectable({ providedIn: 'root' })
export class CustomerDisplayService {
  private channel = new BroadcastChannel('pos_display');

  send(data: DisplayData): void {
    this.channel.postMessage(data);
    localStorage.setItem('pos_display', JSON.stringify(data));
  }

  onMessage(cb: (data: DisplayData) => void): void {
    this.channel.onmessage = (e) => cb(e.data);
  }

  getLastData(): DisplayData | null {
    const raw = localStorage.getItem('pos_display');
    return raw ? JSON.parse(raw) : null;
  }
}
