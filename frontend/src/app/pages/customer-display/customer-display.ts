import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CustomerDisplayService, DisplayData } from '../../services/customer-display';

const WELCOME_MESSAGES = [
  { main: 'Welcome!',     sub: 'We\'re happy to serve you today' },
  { main: 'Hello!',       sub: 'Your order will appear here' },
  { main: 'Thank you',    sub: 'For choosing us' },
  { main: 'Ready for you!', sub: 'Please let us know your order' },
];

@Component({
  selector: 'app-customer-display',
  templateUrl: './customer-display.html',
  styleUrls: ['./customer-display.scss'],
  standalone: false
})
export class CustomerDisplay implements OnInit, OnDestroy {
  data: DisplayData = { items: [], total: 0, currency: 'LKR', status: 'idle' };

  time = '';
  date = '';
  welcomeIndex = 0;
  welcomeVisible = true;

  private clockId: any;
  private pollId: any;
  private welcomeId: any;
  private unsubMessage?: () => void;
  private lastDataJson = '';

  get welcome() { return WELCOME_MESSAGES[this.welcomeIndex]; }

  constructor(
    private displayService: CustomerDisplayService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Load last known state from localStorage immediately
    const last = this.displayService.getLastData();
    if (last) {
      this.data = last;
      this.lastDataJson = JSON.stringify(last);
    }

    // Send PING so the POS tab re-broadcasts its current state right now
    this.displayService.ping();

    // Listen for live BroadcastChannel messages from POS
    this.unsubMessage = this.displayService.onMessage(d => {
      this.data = d;
      this.lastDataJson = JSON.stringify(d);
      this.cdr.markForCheck();
    });

    // Clock — updates every second and also polls localStorage as a fallback
    this.clockId = setInterval(() => {
      const now = new Date();
      this.time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.date = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      // Poll localStorage so we catch updates even if BroadcastChannel missed them
      const raw = localStorage.getItem('pos_display');
      if (raw && raw !== this.lastDataJson) {
        try {
          this.data = JSON.parse(raw);
          this.lastDataJson = raw;
        } catch { /* ignore malformed */ }
      }

      this.cdr.markForCheck();
    }, 1000);

    // Initial clock values immediately (don't wait 1s for first tick)
    const now = new Date();
    this.time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.date = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Rotate welcome messages every 4 s with fade
    this.welcomeId = setInterval(() => {
      this.welcomeVisible = false;
      setTimeout(() => {
        this.welcomeIndex = (this.welcomeIndex + 1) % WELCOME_MESSAGES.length;
        this.welcomeVisible = true;
        this.cdr.markForCheck();
      }, 500);
      this.cdr.markForCheck();
    }, 4000);
  }

  ngOnDestroy(): void {
    clearInterval(this.clockId);
    clearInterval(this.welcomeId);
    this.unsubMessage?.();
  }
}
