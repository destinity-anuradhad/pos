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

  constructor(private zone: NgZone) {
    // Test/debug hook: allows Playwright tests to inject a scan result directly.
    // Usage: window.__scanner.emitScan('1234567890')
    (window as any).__scanner = this;
  }

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
      this.bufferTimeout = setTimeout(() => { this.buffer = ''; }, 200);
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

    // BarcodeDetector: use whenever available (Electron, Chromium 88+, and Playwright's bundled Chromium).
    // Previous reports of it returning [] on Windows were browser-specific; Playwright's Chromium works fine.
    // Fall back to html5-qrcode only on browsers where BarcodeDetector is absent (Firefox, Safari, old Chrome).
    const BarcodeDetectorCtor = (window as any).BarcodeDetector ?? null;

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
    let consecutiveErrors = 0;

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
              consecutiveErrors = 0;
              if (barcodes.length > 0) {
                const code = barcodes[0].rawValue;
                stop();
                this.zone.run(() => this.scanResult$.next(code));
                return;
              }
            } catch { consecutiveErrors++; }
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

  // ── Quagga2.decodeSingle (full frame, full resolution) ────────────────────
  // Full-frame at max resolution + halfSample:false gives Quagga2 the best chance
  // to locate and decode barcodes from a wide-angle webcam.
  private async _scanWithHtml5Qrcode(overlay: HTMLElement): Promise<void> {
    const Quagga = (await import('@ericblade/quagga2')).default;
    const { Html5Qrcode } = await import('html5-qrcode');

    const container = document.getElementById(this.scannerElementId);
    if (container) container.innerHTML = '';

    // ── Camera device ──────────────────────────────────────────────────
    const devices = await Html5Qrcode.getCameras().catch(() => [] as any[]);
    console.log('[Scanner] cameras found:', devices.length,
      devices.map((d: any) => `"${d.label}"`).join(', '));
    const preferredCam = devices.find((d: any) => /back|rear|environment/i.test(d.label)) || devices[0];
    const facingMode = this.isNative ? 'environment' : 'user';

    const hint = document.getElementById('scanner-hint');
    if (hint) hint.textContent = 'Hold barcode in front of camera — 20–40 cm away, keep it steady';

    // ── Get camera stream ─────────────────────────────────────────────
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: preferredCam?.id
          ? { deviceId: { exact: preferredCam.id }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (err: any) {
      overlay.style.display = 'none';
      const msg = err?.message || String(err);
      alert(msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')
        ? 'Camera permission denied. Please allow camera access and try again.'
        : 'Could not start camera: ' + msg);
      return;
    }

    // ── Video (shown to user) ─────────────────────────────────────────
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.style.cssText = 'width:100%;height:auto;display:block;max-height:320px;object-fit:cover;';
    if (container) container.appendChild(video);
    await video.play();

    // ── Canvas for frame capture ──────────────────────────────────────
    const scanCanvas = document.createElement('canvas');
    const sCtx = scanCanvas.getContext('2d')!;

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      stream.getTracks().forEach(t => t.stop());
      overlay.style.display = 'none';
    };
    const closeBtn = document.getElementById('scanner-close');
    if (closeBtn) closeBtn.onclick = () => stop();

    console.log('[Scanner] Quagga2.decodeSingle loop started');
    let firstLog = false;

    const detect = async (): Promise<void> => {
      while (!stopped) {
        await new Promise(r => setTimeout(r, 250)); // ~4 fps
        if (stopped || video.readyState < 2) continue;

        const vw = video.videoWidth; const vh = video.videoHeight;
        if (!vw || !vh) continue;

        // Full frame capture
        scanCanvas.width = vw; scanCanvas.height = vh;
        sCtx.drawImage(video, 0, 0, vw, vh);

        if (!firstLog) {
          firstLog = true;
          console.log('[Scanner] first frame captured:', vw + '×' + vh);
        }

        const dataURL = scanCanvas.toDataURL('image/jpeg', 0.92);

        await new Promise<void>(resolve => {
          Quagga.decodeSingle({
            src: dataURL,
            numOfWorkers: 0,
            inputStream: { size: vh },  // size = height; Quagga scales to this
            decoder: {
              readers: ['ean_reader','ean_8_reader','code_128_reader','code_39_reader',
                        'upc_reader','upc_e_reader','i2of5_reader','codabar_reader'],
            },
            locate: true,
            locator: { patchSize: 'medium', halfSample: false },
          }, (result: any) => {
            if (result?.codeResult?.code && !stopped) {
              const code = result.codeResult.code;
              console.log('[Scanner] ✅ Barcode detected:', code, '| format:', result.codeResult.format);
              stop();
              this.zone.run(() => this.scanResult$.next(code));
            }
            resolve();
          });
        });
      }
    };

    detect().catch(() => {});
  }

  emitScan(code: string): void {
    this.zone.run(() => this.scanResult$.next(code));
  }
}
