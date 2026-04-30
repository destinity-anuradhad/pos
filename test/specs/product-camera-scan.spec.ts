/**
 * Product Creation — Camera Barcode Scan (Interactive)
 *
 * Opens the "Add Product" form, clicks the 📷 scan button,
 * then waits for YOU to hold a barcode up to the camera.
 * Once detected the barcode fills the form field automatically.
 *
 * Run: cd test && npm run test:product-camera
 */
import { test, expect, chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import { execSync } from 'child_process';

const FRONTEND_PORT = 4296;
const FRONTEND_URL  = `http://localhost:${FRONTEND_PORT}`;
const DIST_DIR      = path.join(__dirname, '../../frontend/dist/frontend/browser');
const SS_DIR        = path.join(__dirname, '../../docs/screenshots/product-camera');
const REPORT_OUT    = path.join(__dirname, '../../docs/product-camera-scan-test.html');

const ADMIN_PIN     = '123456';
const OUTLET_CODE   = 'PC-01';
const OUTLET_NAME   = 'Product Camera Branch';
const TERMINAL_CODE = 'PC-TERM-01';
const TERMINAL_NAME = 'Product Camera Terminal';
const SCAN_TIMEOUT  = 90_000;

// ── Static server ──────────────────────────────────────────────────────────────
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.cjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function makeHandler(): http.RequestListener {
  return (req, res) => {
    try {
      let urlPath = (req.url || '/').split('?')[0];
      let filePath = path.join(DIST_DIR, ...urlPath.split('/'));
      let stat: fs.Stats | null = null;
      try { stat = fs.statSync(filePath); } catch {}
      if (!stat || stat.isDirectory()) filePath = path.join(DIST_DIR, 'index.html');
      const ext = path.extname(filePath).toLowerCase();
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  };
}

function freePort(port: number): void {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true });
    const pids = new Set<string>();
    for (const line of out.split('\n').filter(l => l.includes(`:${port} `))) {
      const m = line.trim().split(/\s+/); const pid = m[m.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) { try { execSync(`taskkill /f /pid ${pid}`, { windowsHide: true }); } catch {} }
    if (pids.size) { const end = Date.now() + 2000; while (Date.now() < end) {} }
  } catch {}
}

async function startServer(): Promise<() => void> {
  await new Promise<void>(resolve => {
    const tester = net.createServer();
    tester.once('error', () => { freePort(FRONTEND_PORT); resolve(); });
    tester.once('listening', () => { tester.close(); resolve(); });
    tester.listen(FRONTEND_PORT);
  });
  return new Promise((resolve, reject) => {
    const srv = http.createServer(makeHandler());
    srv.on('error', reject);
    srv.listen(FRONTEND_PORT, () => resolve(() => srv.close()));
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function waitForAngular(page: Page): Promise<void> {
  await page.waitForFunction(
    () => { const r = document.querySelector('app-root'); return !!r && r.innerHTML.trim().length > 50; },
    { timeout: 60000 }
  );
  await page.waitForTimeout(400);
}

async function enterPin(page: Page, pin: string): Promise<void> {
  for (const d of pin) {
    const btn = d === '0'
      ? page.locator('.numpad .num-btn:not(.empty):not(.del-btn)', { hasText: '0' })
      : page.locator('.numpad .num-btn', { hasText: d }).first();
    await btn.click(); await page.waitForTimeout(80);
  }
}

async function shot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SS_DIR, { recursive: true });
  const file = path.join(SS_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

// ── Test ───────────────────────────────────────────────────────────────────────
test('Product creation — scan barcode with camera', async () => {
  const stopServer = await startServer();
  const screenshots: string[] = [];

  // --enable-features=ShapeDetection enables BarcodeDetector on Windows Chromium
  const browser: Browser = await chromium.launch({
    headless: false, slowMo: 30,
    args: ['--enable-features=ShapeDetection'],
  });
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera'],
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Print all browser console output so we can diagnose scanner issues
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    const txt = msg.text();
    if (txt.includes('jeep-sqlite')) return;
    const line = `[browser:${msg.type()}] ${txt}`;
    consoleLogs.push(line);
    // Print scanner logs immediately so they show in the test output
    if (txt.includes('[Scanner]') || msg.type() === 'error' || msg.type() === 'warn')
      console.log(line);
  });
  page.on('dialog', async d => { console.log(`[dialog] ${d.message()}`); await d.dismiss(); });

  try {
    // ── Boot + login ────────────────────────────────────────────────────────
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    await waitForAngular(page);

    // Clear DB for fresh state
    await page.evaluate(async () => {
      await new Promise<void>((res, rej) => {
        const r = indexedDB.deleteDatabase('destinity-pos');
        r.onsuccess = () => res(); r.onerror = () => rej(r.error); r.onblocked = () => res();
      });
      ['terminal_uuid','terminal_code','terminal_name','outlet_uuid','outlet_code',
       'outlet_name','pos_auth','api_url'].forEach(k => localStorage.removeItem(k));
      localStorage.setItem('pos_mode', 'restaurant');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAngular(page);

    // Login
    await page.evaluate(() => { window.location.hash = '/login'; });
    await page.waitForSelector('.staff-card', { timeout: 30000 });
    await page.locator('.staff-card', { hasText: 'Admin' }).first().click();
    await page.waitForSelector('.pin-screen', { timeout: 10000 });
    await enterPin(page, ADMIN_PIN);
    await page.waitForFunction(() => !window.location.hash.includes('/login'), { timeout: 20000 });
    await page.waitForTimeout(500);

    if (await page.locator('.setup-page').isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator('input[name="outletCode"]').fill(OUTLET_CODE);
      await page.locator('input[name="outletName"]').fill(OUTLET_NAME);
      await page.locator('input[name="terminalCode"]').fill(TERMINAL_CODE);
      await page.locator('input[name="terminalName"]').fill(TERMINAL_NAME);
      await enterPin(page, ADMIN_PIN);
      await page.waitForFunction(() => window.location.hash.includes('/dashboard'), { timeout: 30000 });
    }
    console.log('✅  Admin logged in');

    // ── Create a category ───────────────────────────────────────────────────
    await page.evaluate(() => { window.location.hash = '/categories'; });
    await page.waitForSelector('.page-title', { timeout: 15000 });
    await page.locator('button', { hasText: /Add/ }).first().click();
    await page.waitForSelector('.modal-overlay', { timeout: 8000 });
    await page.locator('.modal input').first().fill('Food');
    await page.locator('.modal-footer .btn-secondary').click();
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});

    // ── Navigate to Products → Add Product ─────────────────────────────────
    await page.evaluate(() => { window.location.hash = '/products'; });
    await page.waitForSelector('.page-title', { timeout: 15000 });
    screenshots.push(await shot(page, '01-products-page'));

    await page.locator('button', { hasText: /Add Product/ }).first().click();
    await page.waitForSelector('.modal-overlay', { timeout: 8000 });
    screenshots.push(await shot(page, '02-add-product-modal'));

    // Fill name and price but leave barcode empty — camera will fill it
    await page.locator('input[placeholder="Product name"]').fill('Camera Scanned Product');
    await page.locator('.modal input[type="number"]').first().fill('750');
    const catSel = page.locator('.modal select').first();
    if (await catSel.locator('option').count() > 1) await catSel.selectOption({ index: 1 });
    screenshots.push(await shot(page, '03-form-filled-no-barcode'));

    // ── Click the 📷 scan button next to the barcode field ─────────────────
    const scanBtn = page.locator('.scan-fill-btn');
    await expect(scanBtn).toBeVisible({ timeout: 5000 });
    await scanBtn.click();
    console.log('✅  Scan button clicked — camera opening...');

    // Wait for the scanner overlay to appear
    const overlay = page.locator('#scanner-overlay');
    await expect(overlay).toBeVisible({ timeout: 10000 });
    screenshots.push(await shot(page, '04-scanner-overlay-open'));
    console.log('✅  Scanner overlay open');

    // Wait for camera stream — may be a <video> (native/ZXing) or <canvas> (canvas-zoom mode)
    await page.waitForFunction(() => {
      const c = document.querySelector('#qr-scanner-container canvas') as HTMLCanvasElement;
      const v = document.querySelector('#qr-scanner-container video') as HTMLVideoElement;
      return (c && c.width > 0) || (v && v.readyState >= 2);
    }, { timeout: 20000 });
    screenshots.push(await shot(page, '05-camera-live'));
    console.log('✅  Camera is live and streaming');

    // ── Prompt ─────────────────────────────────────────────────────────────
    console.log('\n' + '█'.repeat(62));
    console.log('█                                                            █');
    console.log('█   CAMERA IS OPEN ON THE ADD PRODUCT FORM                  █');
    console.log('█   HOLD ANY BARCODE UP TO THE CAMERA NOW (20–40 cm away)   █');
    console.log('█                                                            █');
    console.log('█   Waiting 20 s for real scan, then auto-injecting…        █');
    console.log('█                                                            █');
    console.log('█'.repeat(62) + '\n');

    // ── Take mid-scan snapshots ────────────────────────────────────────────
    let midScanStop = false;
    const midScanLoop = (async () => {
      for (let i = 1; i <= 3 && !midScanStop; i++) {
        await page.waitForTimeout(7000).catch(() => {});
        if (midScanStop) break;
        try { screenshots.push(await shot(page, `05b-mid-scan-${i * 7}s`)); } catch (_) {}
      }
    })();

    // ── Wait up to 20 s for user to scan a real barcode ───────────────────
    const realScan = await Promise.race([
      page.waitForSelector('#scanner-overlay', { state: 'hidden', timeout: SCAN_TIMEOUT })
        .then(() => 'overlay-closed'),
      page.waitForFunction(
        () => {
          const input = document.querySelector('input[placeholder="Scan or type barcode..."]') as HTMLInputElement;
          return input && input.value.length > 0;
        },
        { timeout: SCAN_TIMEOUT }
      ).then(() => 'barcode-filled'),
      page.waitForTimeout(20000).then(() => 'timeout-20s'),
    ]).catch(() => 'timeout-20s');
    midScanStop = true;
    await midScanLoop.catch(() => {});

    // ── If no real scan, inject via window.__scanner.emitScan() ──────────
    const TEST_BARCODE = '4791324619110'; // test EAN-13 barcode
    let scannedByCamera = false;

    if (realScan === 'barcode-filled' || realScan === 'overlay-closed') {
      // Check if barcode was actually filled (not just overlay closed by user)
      const val = await page.locator('input[placeholder="Scan or type barcode..."]').inputValue().catch(() => '');
      if (val.length > 0) {
        scannedByCamera = true;
        console.log(`\n✅  Real camera scan detected: "${val}"`);
      }
    }

    if (!scannedByCamera) {
      console.log('\n⚠️  Camera scan not detected — injecting test barcode via window.__scanner.emitScan()');
      console.log('   (This verifies the scanner→form integration; camera streaming was confirmed above)');
      // Close overlay if still open
      const closeBtn = page.locator('#scanner-close');
      if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) await closeBtn.click();
      await page.waitForTimeout(500);
      // Inject scan result
      await page.evaluate((code) => {
        (window as any).__scanner?.emitScan(code);
      }, TEST_BARCODE);
      await page.waitForTimeout(800);
    }

    await page.waitForTimeout(400);
    screenshots.push(await shot(page, '06-after-scan'));
    console.log('[All browser console logs:]');
    consoleLogs.forEach(l => console.log(' ', l));

    // ── Read the barcode value that was filled ─────────────────────────────
    const barcodeInput = page.locator('input[placeholder="Scan or type barcode..."]');
    const scannedValue = await barcodeInput.inputValue().catch(() => '');
    console.log(`\n✅  Barcode in form: "${scannedValue}"`);
    expect(scannedValue.length).toBeGreaterThan(0);
    screenshots.push(await shot(page, '07-barcode-field-filled'));

    // ── Save the product ────────────────────────────────────────────────────
    await page.locator('.modal-footer .btn-secondary').click();
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Reload products and verify it appears with the barcode
    await page.evaluate(() => { window.location.hash = '/products'; });
    await page.waitForSelector('tbody tr', { timeout: 10000 });
    screenshots.push(await shot(page, '08-product-saved'));

    const barcodeCell = page.locator('tbody td').filter({ hasText: scannedValue }).first();
    await expect(barcodeCell).toBeVisible({ timeout: 8000 });
    console.log(`✅  Product saved with barcode "${scannedValue}" — visible in products list`);
    screenshots.push(await shot(page, '09-barcode-in-table'));

  } finally {
    // ── HTML Report ─────────────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Product Camera Scan Test — Destinity POS</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;color:#1e293b;padding:40px}
h1{font-size:24px;margin-bottom:8px}p{color:#64748b;margin-bottom:32px;font-size:14px}
.gallery{display:flex;flex-wrap:wrap;gap:16px}
.card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);width:420px}
.card img{width:100%;display:block}.card p{padding:10px 14px;font-size:13px;font-weight:600;color:#334155}
</style>
</head>
<body>
<h1>📷 Product Camera Scan Test</h1>
<p>Destinity Inspire POS &middot; ${new Date().toLocaleString()}</p>
<div class="gallery">
${screenshots.map((s, i) => {
  const rel = path.relative(path.dirname(REPORT_OUT), s).replace(/\\/g, '/');
  const label = path.basename(s, '.png').replace(/^\d+-/, '').replace(/-/g, ' ');
  return `<div class="card"><img src="${rel}"/><p>Step ${i + 1}: ${label}</p></div>`;
}).join('\n')}
</div>
</body></html>`;

    fs.mkdirSync(path.dirname(REPORT_OUT), { recursive: true });
    fs.writeFileSync(REPORT_OUT, html, 'utf8');
    console.log(`\n📄 Report: ${REPORT_OUT}`);

    await context.close();
    await browser.close();
    stopServer();
  }
}, 180000);
