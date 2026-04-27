import { Injectable } from '@angular/core';

export interface DisplayData {
  items: { name: string; qty: number; price: number }[];
  total: number;
  currency: string;
  status: 'idle' | 'ordering' | 'checkout';
}

const STORAGE_KEY = 'pos_display';

@Injectable({ providedIn: 'root' })
export class CustomerDisplayService {
  private channel = new BroadcastChannel('pos_display');

  // POS → send state to display
  send(data: DisplayData): void {
    const payload = { ...data, _ts: Date.now() };
    this.channel.postMessage({ type: 'DATA', payload });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  // Display → ask POS to re-broadcast its current state
  ping(): void {
    this.channel.postMessage({ type: 'PING' });
  }

  // Display listens for DATA messages from POS
  onMessage(cb: (data: DisplayData) => void): () => void {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'DATA') cb(e.data.payload);
    };
    this.channel.addEventListener('message', handler);
    return () => this.channel.removeEventListener('message', handler);
  }

  // POS listens for PING from display and re-sends state
  onPing(cb: () => void): () => void {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'PING') cb();
    };
    this.channel.addEventListener('message', handler);
    return () => this.channel.removeEventListener('message', handler);
  }

  getLastData(): DisplayData | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
}
