import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ScannerService {
  private scanResult$ = new Subject<string>();
  scanResult = this.scanResult$.asObservable();

  private buffer = '';
  private bufferTimeout: any;

  // Web/Desktop: listen for USB barcode scanner (acts as keyboard, ends with Enter)
  startKeyboardListener(): void {
    document.addEventListener('keydown', this.handleKey.bind(this));
  }

  stopKeyboardListener(): void {
    document.removeEventListener('keydown', this.handleKey.bind(this));
  }

  private handleKey(e: KeyboardEvent): void {
    // Ignore if user is typing in an input/textarea
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'Enter') {
      if (this.buffer.length > 2) {
        this.scanResult$.next(this.buffer);
      }
      this.buffer = '';
      clearTimeout(this.bufferTimeout);
    } else if (e.key.length === 1) {
      this.buffer += e.key;
      clearTimeout(this.bufferTimeout);
      this.bufferTimeout = setTimeout(() => { this.buffer = ''; }, 100);
    }
  }

  // Manual emit (for testing or Capacitor callback)
  emitScan(code: string): void {
    this.scanResult$.next(code);
  }
}
