import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ScannerService {
  private scanResult$ = new Subject<string>();
  scanResult = this.scanResult$.asObservable();

  private buffer = '';
  private bufferTimeout: any;
  private listening = false;
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

  // Camera scan using html5-qrcode
  async scanWithCamera(): Promise<void> {
    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

    // Build / show overlay
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
          <div id="${this.scannerElementId}" style="width:100%;min-height:280px;"></div>
          <p id="scanner-hint">Point camera at barcode or QR code</p>
        </div>
      `;
      overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.85);
        display:flex;align-items:center;justify-content:center;
        z-index:9999;padding:16px;
      `;
      const modal = overlay.querySelector('#scanner-modal') as HTMLElement;
      modal.style.cssText = `
        background:#1a1a1a;border-radius:16px;overflow:hidden;
        width:100%;max-width:420px;
      `;
      const header = overlay.querySelector('#scanner-header') as HTMLElement;
      header.style.cssText = `
        display:flex;align-items:center;justify-content:space-between;
        padding:14px 18px;background:#094f70;color:white;font-weight:700;
      `;
      const closeBtn = overlay.querySelector('#scanner-close') as HTMLElement;
      closeBtn.style.cssText = `
        background:none;border:none;color:white;font-size:20px;
        cursor:pointer;padding:4px 8px;
      `;
      const hint = overlay.querySelector('#scanner-hint') as HTMLElement;
      hint.style.cssText = `
        text-align:center;color:rgba(255,255,255,0.6);font-size:12px;padding:10px;
      `;
      document.body.appendChild(overlay);
    }

    // Always clear the container before creating a new scanner instance
    // (reusing a dirty div from a previous scan causes silent failure)
    const container = document.getElementById(this.scannerElementId);
    if (container) container.innerHTML = '';

    overlay.style.display = 'flex';

    // Support QR codes AND all common 1D retail barcodes
    const formats = [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.CODABAR,
    ];

    const html5Qrcode = new Html5Qrcode(this.scannerElementId, { formatsToSupport: formats });

    const closeScanner = async () => {
      try {
        if (html5Qrcode.isScanning) await html5Qrcode.stop();
      } catch (_) {}
      try { html5Qrcode.clear(); } catch (_) {}
      if (overlay) overlay.style.display = 'none';
    };

    const closeBtn = document.getElementById('scanner-close');
    if (closeBtn) closeBtn.onclick = () => closeScanner();

    // qrbox: wide rectangle is better for 1D barcodes; square for QR codes
    const qrboxFn = (vw: number, vh: number) => ({
      width:  Math.min(Math.round(vw * 0.85), 360),
      height: Math.min(Math.round(vh * 0.45), 180),
    });

    const startCamera = async (facingMode: string) => {
      await html5Qrcode.start(
        { facingMode },
        { fps: 15, qrbox: qrboxFn },
        (decodedText: string) => {
          this.scanResult$.next(decodedText);
          closeScanner();
        },
        () => {} // per-frame failure is normal — ignore
      );
    };

    try {
      // Try rear camera first (best for scanning)
      await startCamera('environment');
    } catch (err: any) {
      try {
        // Fall back to front/any camera
        await startCamera('user');
      } catch (err2: any) {
        closeScanner();
        const msg = (err2?.message || err2 || err?.message || err)?.toString() || '';
        if (msg.toLowerCase().includes('permission')) {
          alert('Camera permission denied. Please allow camera access in your device settings and try again.');
        } else {
          alert('Could not start camera: ' + msg);
        }
      }
    }
  }

  emitScan(code: string): void {
    this.scanResult$.next(code);
  }
}
