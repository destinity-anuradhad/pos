import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ScannerService {
  private scanResult$ = new Subject<string>();
  scanResult = this.scanResult$.asObservable();

  private buffer = '';
  private bufferTimeout: any;
  private listening = false;
  private scannerElementId = 'qr-scanner-container';
  private boundHandleKey = this.handleKey.bind(this); // saved reference for proper removeEventListener

  constructor(private zone: NgZone) {}

  get isNative(): boolean {
    return typeof (window as any).Capacitor !== 'undefined' &&
           (window as any).Capacitor?.isNativePlatform?.();
  }

  // Web/Desktop: USB barcode scanner keyboard wedge
  startKeyboardListener(): void {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener('keydown', this.boundHandleKey);
  }

  stopKeyboardListener(): void {
    this.listening = false;
    document.removeEventListener('keydown', this.boundHandleKey);
  }

  private handleKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Enter') {
      if (this.buffer.length > 2) {
        const code = this.buffer;
        this.zone.run(() => this.scanResult$.next(code));
      }
      this.buffer = '';
      clearTimeout(this.bufferTimeout);
    } else if (e.key.length === 1) {
      this.buffer += e.key;
      clearTimeout(this.bufferTimeout);
      this.bufferTimeout = setTimeout(() => { this.buffer = ''; }, 100);
    }
  }

  // Camera scan — uses native BarcodeDetector (Chromium/Electron) with html5-qrcode fallback
  async scanWithCamera(): Promise<void> {
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
          <div id="${this.scannerElementId}" style="width:100%;position:relative;background:#000;min-height:280px;"></div>
          <p id="scanner-hint">Hold barcode/QR code steady in front of the camera</p>
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

    const container = document.getElementById(this.scannerElementId)!;
    container.innerHTML = '';
    overlay.style.display = 'flex';

    const BarcodeDetectorCtor = (window as any).BarcodeDetector;
    if (BarcodeDetectorCtor) {
      await this._scanWithNativeDetector(overlay, container, BarcodeDetectorCtor);
    } else {
      await this._scanWithHtml5Qrcode(overlay);
    }
  }

  // ── Native BarcodeDetector (Chromium 83+ / Electron 12+) ─────────
  private async _scanWithNativeDetector(
    overlay: HTMLElement, container: HTMLElement, BarcodeDetectorCtor: any
  ): Promise<void> {
    let stream: MediaStream | null = null;
    let rafId: number | null = null;

    const stop = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach(t => t.stop());
      overlay.style.display = 'none';
    };

    const closeBtn = document.getElementById('scanner-close');
    if (closeBtn) closeBtn.onclick = () => stop();

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      const video = document.createElement('video');
      video.style.cssText = 'width:100%;height:auto;display:block;max-height:320px;object-fit:cover;';
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      container.appendChild(video);

      // Viewfinder guide box
      const vf = document.createElement('div');
      vf.style.cssText = `
        position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        width:240px;height:240px;
        border:3px solid #0af;border-radius:12px;pointer-events:none;
        box-shadow:0 0 0 9999px rgba(0,0,0,0.35);
      `;
      container.appendChild(vf);

      await video.play();

      const formats = ['qr_code','ean_13','ean_8','code_128','code_39','code_93','upc_a','upc_e','itf','codabar'];
      const detector = new BarcodeDetectorCtor({ formats });

      let lastCheck = 0;
      const scan = async (ts: number) => {
        if (ts - lastCheck >= 80) { // ~12 fps is plenty for barcode detection
          lastCheck = ts;
          if (video.readyState >= 2) {
            try {
              const barcodes: any[] = await detector.detect(video);
              if (barcodes.length > 0) {
                const code = barcodes[0].rawValue;
                stop();
                this.zone.run(() => this.scanResult$.next(code));
                return;
              }
            } catch (_) {}
          }
        }
        rafId = requestAnimationFrame(scan);
      };
      rafId = requestAnimationFrame(scan);
    } catch (err: any) {
      stop();
      const msg = err?.message || String(err);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        alert('Camera permission denied. Please allow camera access and try again.');
      } else {
        alert('Could not start camera: ' + msg);
      }
    }
  }

  // ── html5-qrcode fallback (mobile / older browsers) ──────────────
  private async _scanWithHtml5Qrcode(overlay: HTMLElement): Promise<void> {
    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

    const container = document.getElementById(this.scannerElementId);
    if (container) container.innerHTML = '';

    const formats = [
      Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,   Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,   Html5QrcodeSupportedFormats.ITF,
    ];

    const html5Qrcode = new Html5Qrcode(this.scannerElementId, { formatsToSupport: formats, verbose: false });

    const closeScanner = async () => {
      try { if (html5Qrcode.isScanning) await html5Qrcode.stop(); } catch (_) {}
      try { html5Qrcode.clear(); } catch (_) {}
      overlay.style.display = 'none';
    };

    const closeBtn = document.getElementById('scanner-close');
    if (closeBtn) closeBtn.onclick = () => closeScanner();

    const qrboxFn = (vw: number, vh: number) => {
      const size = Math.min(Math.round(Math.min(vw, vh) * 0.8), 360);
      return { width: size, height: size };
    };

    try {
      const devices = await Html5Qrcode.getCameras().catch(() => [] as any[]);
      const constraint = devices.length > 0
        ? { deviceId: { exact: (devices.find((d: any) => /back|rear|environment/i.test(d.label)) || devices[0]).id } }
        : { facingMode: 'user' };

      await html5Qrcode.start(
        constraint,
        { fps: 20, qrbox: qrboxFn, aspectRatio: 1.0 },
        (decodedText: string) => { this.zone.run(() => this.scanResult$.next(decodedText)); closeScanner(); },
        () => {}
      );
    } catch (err: any) {
      closeScanner();
      const msg = err?.message || String(err);
      alert(msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')
        ? 'Camera permission denied. Please allow camera access and try again.'
        : 'Could not start camera: ' + msg);
    }
  }

  emitScan(code: string): void {
    this.zone.run(() => this.scanResult$.next(code));
  }
}
