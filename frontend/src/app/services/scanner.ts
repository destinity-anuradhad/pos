import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ScannerService {
  private scanResult$ = new Subject<string>();
  scanResult = this.scanResult$.asObservable();

  private buffer = '';
  private bufferTimeout: any;
  private listening = false;

  get isNative(): boolean {
    return typeof (window as any).Capacitor !== 'undefined' &&
           (window as any).Capacitor?.isNativePlatform?.();
  }

  // Web/Desktop: USB barcode scanner keyboard wedge
  startKeyboardListener(): void {
    if (this.listening || this.isNative) return;
    this.listening = true;
    document.addEventListener('keydown', this.handleKey.bind(this));
  }

  stopKeyboardListener(): void {
    this.listening = false;
    document.removeEventListener('keydown', this.handleKey.bind(this));
  }

  private handleKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'Enter') {
      if (this.buffer.length > 2) this.scanResult$.next(this.buffer);
      this.buffer = '';
      clearTimeout(this.bufferTimeout);
    } else if (e.key.length === 1) {
      this.buffer += e.key;
      clearTimeout(this.bufferTimeout);
      this.bufferTimeout = setTimeout(() => { this.buffer = ''; }, 100);
    }
  }

  // Native mobile: open camera with Capacitor MLKit
  async scanWithCamera(): Promise<void> {
    if (!this.isNative) {
      console.warn('Camera scan only available on native mobile');
      return;
    }

    try {
      const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');

      // Request permissions
      const { camera } = await BarcodeScanner.requestPermissions();
      if (camera !== 'granted' && camera !== 'limited') {
        alert('Camera permission is required to scan barcodes.');
        return;
      }

      // Scan
      const { barcodes } = await BarcodeScanner.scan();
      if (barcodes.length > 0 && barcodes[0].rawValue) {
        this.scanResult$.next(barcodes[0].rawValue);
      }
    } catch (err) {
      console.error('Barcode scan failed:', err);
    }
  }

  emitScan(code: string): void {
    this.scanResult$.next(code);
  }
}
