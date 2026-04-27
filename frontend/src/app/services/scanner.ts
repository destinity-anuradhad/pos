import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ScannerService {
  private scanResult$ = new Subject<string>();
  scanResult = this.scanResult$.asObservable();

  private buffer = '';
  private bufferTimeout: any;
  private listening = false;
  private html5Scanner: any = null;
  private scannerElementId = 'qr-scanner-container';

  get isNative(): boolean {
    return typeof (window as any).Capacitor !== 'undefined' &&
           (window as any).Capacitor?.isNativePlatform?.();
  }

  // Web/Desktop: USB barcode scanner keyboard wedge
  startKeyboardListener(): void {
    if (this.listening) return;
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

  // Camera scan using html5-qrcode (works on mobile WebView + desktop webcam)
  async scanWithCamera(): Promise<void> {
    const { Html5Qrcode } = await import('html5-qrcode');

    // Create overlay container
    let overlay = document.getElementById('scanner-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'scanner-overlay';
      overlay.innerHTML = `
        <div id="scanner-modal">
          <div id="scanner-header">
            <span>📷 Scan Barcode / QR Code</span>
            <button id="scanner-close">✕</button>
          </div>
          <div id="${this.scannerElementId}"></div>
          <p id="scanner-hint">Point camera at barcode or QR code</p>
        </div>
      `;
      overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.85);
        display:flex; align-items:center; justify-content:center;
        z-index:9999; padding:16px;
      `;
      const modal = overlay.querySelector('#scanner-modal') as HTMLElement;
      modal.style.cssText = `
        background:#1a1a1a; border-radius:16px; overflow:hidden;
        width:100%; max-width:400px;
      `;
      const header = overlay.querySelector('#scanner-header') as HTMLElement;
      header.style.cssText = `
        display:flex; align-items:center; justify-content:space-between;
        padding:14px 18px; background:#094f70; color:white; font-weight:700;
      `;
      const closeBtn = overlay.querySelector('#scanner-close') as HTMLElement;
      closeBtn.style.cssText = `
        background:none; border:none; color:white; font-size:20px;
        cursor:pointer; padding:4px 8px;
      `;
      const hint = overlay.querySelector('#scanner-hint') as HTMLElement;
      hint.style.cssText = `
        text-align:center; color:rgba(255,255,255,0.6);
        font-size:12px; padding:10px;
      `;
      document.body.appendChild(overlay);
    }

    overlay.style.display = 'flex';

    const html5Qrcode = new Html5Qrcode(this.scannerElementId);
    this.html5Scanner = html5Qrcode;

    const closeScanner = async () => {
      try {
        if (html5Qrcode.isScanning) {
          await html5Qrcode.stop();
        }
      } catch (_) {}
      if (overlay) overlay.style.display = 'none';
    };

    const closeBtn = document.getElementById('scanner-close');
    if (closeBtn) {
      closeBtn.onclick = () => closeScanner();
    }

    try {
      await html5Qrcode.start(
        { facingMode: 'environment' }, // rear camera
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText: string) => {
          this.scanResult$.next(decodedText);
          closeScanner();
        },
        () => {} // ignore scan failures (happens every frame until success)
      );
    } catch (err: any) {
      closeScanner();
      if (err?.toString()?.includes('Permission')) {
        alert('Camera permission denied. Please allow camera access and try again.');
      } else {
        alert('Could not start camera: ' + (err?.message || err));
      }
    }
  }

  emitScan(code: string): void {
    this.scanResult$.next(code);
  }
}
