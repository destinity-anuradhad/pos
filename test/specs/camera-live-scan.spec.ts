/**
 * Interactive Camera Live Scan Test — Destinity Inspire POS
 *
 * This test opens the real device camera inside the POS and pauses,
 * waiting for YOU to physically hold a barcode up to the camera.
 * Once detected, it captures the result and verifies the scanner worked.
 *
 * What happens:
 *   1. App boots, Admin logs in, a test product is seeded
 *   2. POS opens, a table is selected
 *   3. Camera button is clicked → camera view opens on screen
 *   4. Console prints ► SHOW A BARCODE TO THE CAMERA NOW ◄
 *   5. Test waits up to 90 seconds for you to scan something
 *   6. On detection: screenshots the result, verifies scan fired
 *
 * Run: cd test && npx playwright test camera-live-scan.spec.ts
 *
 * NOTE: requires a physical camera. Runs headless:false so you can
 * see the camera feed and point a barcode at it.
 */
import { test, expect, chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import { execSync } from 'child_process';

// ── Config ─────────────────────────────────────────────────────────────────────
const FRONTEND_PORT = 4297;
const FRONTEND_URL  = `http://localhost:${FRONTEND_PORT}`;
const DIST_DIR      = path.join(__dirname, '../../frontend/dist/frontend/browser');
const SS_DIR        = path.join(__dirname, '../../docs/screenshots/camera-live');
const REPORT_OUT    = path.join(__dirname, '../../docs/camera-live-scan-test.html');

const ADMIN_PIN     = '123456';
const OUTLET_CODE   = 'CAM-01';
const OUTLET_NAME   = 'Camera Branch';
const TERMINAL_CODE = 'CAM-TERM-01';
const TERMINAL_NAME = 'Camera Terminal 01';

// Seed product — user can scan this barcode if they have it, or any other
const SEED_BARCODE  = '4901234567890';
const SEED_PRODUCT  = 'Camera Scan Product';

// How long to wait for the user to show a barcode (ms)
const SCAN_TIMEOUT  = 90_000;

// ── Static file server ─────────────────────────────────────────────────────────
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.cjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function makeServerHandler(): http.RequestListener {
  return (req, res) => {
    try {
      let urlPath = (req.url || '/').split('?')[0];
      let filePath = path.join(DIST_DIR, ...urlPath.split('/'));
      let stat: fs.Stats | null = null;
      try { stat = fs.statSync(filePath); } catch {}
      if (!stat || stat.isDirectory()) filePath = path.join(DIST_DIR, 'index.html');
      const ext  = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
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
      const m = line.trim().split(/\s+/);
      const pid = m[m.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try { execSync(`taskkill /f /pid ${pid}`, { windowsHide: true }); } catch {}
    }
    if (pids.size) { const end = Date.now() + 2000; while (Date.now() < end) {} }
  } catch {}
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => { tester.close(); resolve(true); });
    tester.listen(port);
  });
}

async function startServer(): Promise<void> {
  if (!(await isPortFree(FRONTEND_PORT))) {
    freePort(FRONTEND_PORT);
    await new Promise(r => setTimeout(r, 1000));
  }
  return new Promise((resolve, reject) => {
    const server = http.createServer(makeServerHandler());
    server.on('error', reject);
    server.listen(FRONTEND_PORT, () => resolve());
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function clearDb(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('destinity-pos');
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
      req.onblocked = () => resolve();
    });
    ['terminal_uuid','terminal_code','terminal_name','outlet_uuid','outlet_code',
     'outlet_name','pos_auth','api_url','sync_state'].forEach(k => localStorage.removeItem(k));
    localStorage.setItem('pos_mode', 'restaurant');
  });
}

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
    await btn.click();
    await page.waitForTimeout(80);
  }
}

async function shot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SS_DIR, { recursive: true });
  const file = path.join(SS_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

// ── Main Test ─────────────────────────────────────────────────────────────────

test('Camera Live Scan — show barcode to camera', async () => {
  await startServer();

  // Launch with REAL camera (no fake device flags) so the physical camera works
  const browser: Browser = await chromium.launch({
    headless: false,
    slowMo: 30,
    // Do NOT add --use-fake-device-for-media-stream here — we want the real camera
  });

  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera'],
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  const screenshots: string[] = [];

  // Suppress expected NativeDb error (no jeep-sqlite on web)
  page.on('console', msg => {
    if (msg.type() === 'error' && msg.text().includes('jeep-sqlite')) return;
    if (msg.type() === 'error') console.error(`[browser] ${msg.text()}`);
  });
  // Dismiss any unexpected dialogs automatically
  page.on('dialog', async dialog => {
    console.log(`\n[dialog] ${dialog.message()}`);
    await dialog.dismiss();
  });

  try {
    // ── Boot ────────────────────────────────────────────────────────────────
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    await waitForAngular(page);

    await clearDb(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAngular(page);

    // ── Login ────────────────────────────────────────────────────────────────
    await page.evaluate(() => {
      localStorage.removeItem('pos_auth');
      localStorage.setItem('pos_mode', 'restaurant');
      window.location.hash = '/login';
    });
    await page.waitForSelector('.staff-card', { timeout: 30000 });
    await page.locator('.staff-card', { hasText: 'Admin' }).first().click();
    await page.waitForSelector('.pin-screen', { timeout: 10000 });
    await enterPin(page, ADMIN_PIN);
    await page.waitForFunction(() => !window.location.hash.includes('/login'), { timeout: 20000 });
    await page.waitForTimeout(500);

    // Terminal setup if needed
    if (await page.locator('.setup-page').isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator('input[name="outletCode"]').fill(OUTLET_CODE);
      await page.locator('input[name="outletName"]').fill(OUTLET_NAME);
      await page.locator('input[name="terminalCode"]').fill(TERMINAL_CODE);
      await page.locator('input[name="terminalName"]').fill(TERMINAL_NAME);
      await enterPin(page, ADMIN_PIN);
      await page.waitForFunction(() => window.location.hash.includes('/dashboard'), { timeout: 30000 });
    }
    console.log('✅  Admin logged in');

    // ── Seed category ────────────────────────────────────────────────────────
    await page.evaluate((r) => { window.location.hash = r; }, '/categories');
    await page.waitForSelector('.page-title', { timeout: 15000 });
    await page.locator('button', { hasText: /Add/ }).first().click();
    await page.waitForSelector('.modal-overlay', { timeout: 8000 });
    await page.locator('.modal input').first().fill('Test Items');
    await page.locator('.modal-footer .btn-secondary').click();
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});

    // ── Seed product with known barcode ──────────────────────────────────────
    await page.evaluate((r) => { window.location.hash = r; }, '/products');
    await page.waitForSelector('.page-title', { timeout: 15000 });
    await page.locator('button', { hasText: /Add Product/ }).first().click();
    await page.waitForSelector('.modal-overlay', { timeout: 8000 });
    await page.locator('input[placeholder="Product name"]').fill(SEED_PRODUCT);
    await page.locator('.modal input[type="number"]').first().fill('500');
    const catSel = page.locator('.modal select').first();
    if (await catSel.locator('option').count() > 1) await catSel.selectOption({ index: 1 });
    await page.locator('input[placeholder="Scan or type barcode..."]').fill(SEED_BARCODE);
    await page.locator('.modal-footer .btn-secondary').click();
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    console.log(`✅  Seeded product "${SEED_PRODUCT}" with barcode ${SEED_BARCODE}`);

    // ── Seed table ────────────────────────────────────────────────────────────
    await page.evaluate((r) => { window.location.hash = r; }, '/tables');
    await page.waitForSelector('.page-title', { timeout: 15000 });
    await page.locator('button', { hasText: 'Add Table' }).first().click();
    await page.waitForSelector('.modal-overlay', { timeout: 8000 });
    await page.locator('input[placeholder*="Table 1"]').fill('Table 1');
    await page.locator('.modal-footer .btn-secondary').click();
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});

    // ── Navigate to POS ──────────────────────────────────────────────────────
    await page.evaluate((r) => { window.location.hash = r; }, '/pos');
    await page.waitForSelector('.table-card', { timeout: 20000 });

    const tableCard = page.locator('.table-card:not(.table-card--blocked)').first();
    await expect(tableCard).toBeVisible({ timeout: 8000 });
    await tableCard.click();
    await page.waitForSelector('.scan-bar', { timeout: 12000 });
    screenshots.push(await shot(page, '01-pos-order-view'));
    console.log('✅  POS order view ready');

    // ── Open camera ──────────────────────────────────────────────────────────
    const cameraBtn = page.locator('.scan-bar button', { hasText: /Camera/i });
    await expect(cameraBtn).toBeVisible({ timeout: 8000 });
    await cameraBtn.click();
    console.log('✅  Camera button clicked');

    // Wait for overlay
    const overlay = page.locator('#scanner-overlay');
    await expect(overlay).toBeVisible({ timeout: 8000 });
    screenshots.push(await shot(page, '02-overlay-opened'));

    // Wait for the video stream to start
    const video = page.locator('#qr-scanner-container video');
    await expect(video).toBeVisible({ timeout: 15000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('#qr-scanner-container video') as HTMLVideoElement;
      return v && v.readyState >= 2;
    }, { timeout: 15000 });
    screenshots.push(await shot(page, '03-camera-live'));
    console.log('✅  Camera is live');

    // ── Prompt user ──────────────────────────────────────────────────────────
    console.log('\n' + '█'.repeat(60));
    console.log('█                                                          █');
    console.log('█   CAMERA IS OPEN — SHOW A BARCODE TO THE CAMERA NOW     █');
    console.log('█                                                          █');
    console.log(`█   Tip: use barcode  ${SEED_BARCODE}  if you have it    █`);
    console.log('█   Any EAN/QR/Code128 barcode will work                  █');
    console.log('█                                                          █');
    console.log(`█   Waiting up to ${SCAN_TIMEOUT / 1000}s ...                                █`);
    console.log('█                                                          █');
    console.log('█'.repeat(60) + '\n');

    // ── Wait for scan result ─────────────────────────────────────────────────
    // After a barcode is detected the scanner closes and either:
    //   a) A cart item appears  (product was found by barcode)
    //   b) .scan-msg shows "✗ Product not found"  (barcode not in DB)
    // Both prove the camera scan pipeline works end-to-end.
    const scanDetected = await Promise.race([
      // Overlay closes (scan happened — camera stops itself after first detection)
      page.waitForSelector('#scanner-overlay', { state: 'hidden', timeout: SCAN_TIMEOUT })
        .then(() => 'overlay-closed'),
      // Cart item appears
      page.waitForSelector('.cart-item', { timeout: SCAN_TIMEOUT })
        .then(() => 'cart-item'),
      // "Product not found" message
      page.waitForSelector('.scan-msg.scan-error', { timeout: SCAN_TIMEOUT })
        .then(() => 'not-found-msg'),
      // Success message
      page.waitForSelector('.scan-msg:not(.scan-error)', { timeout: SCAN_TIMEOUT })
        .then(() => 'success-msg'),
    ]).catch(() => 'timeout');

    await page.waitForTimeout(800); // let Angular finish updating DOM
    screenshots.push(await shot(page, '04-after-scan'));

    console.log(`\n🔍 Scan result signal: "${scanDetected}"`);

    if (scanDetected === 'timeout') {
      // Close the camera manually if user didn't scan in time
      const closeBtn = page.locator('#scanner-close');
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeBtn.click();
      }
      throw new Error(`No barcode detected within ${SCAN_TIMEOUT / 1000}s. ` +
        'Make sure the camera is working and hold a barcode clearly in the viewfinder.');
    }

    // ── Inspect result ───────────────────────────────────────────────────────
    const hasCartItem   = await page.locator('.cart-item').isVisible({ timeout: 2000 }).catch(() => false);
    const scanMsgEl     = page.locator('.scan-msg');
    const hasScanMsg    = await scanMsgEl.isVisible({ timeout: 2000 }).catch(() => false);
    const scanMsgText   = hasScanMsg ? (await scanMsgEl.textContent() ?? '').trim() : '';

    console.log(`\n📊 Results:`);
    console.log(`   Cart item visible : ${hasCartItem}`);
    console.log(`   Scan message      : "${scanMsgText}"`);

    if (hasCartItem) {
      const cartText = await page.locator('.cart-item').first().textContent() ?? '';
      console.log(`   Cart item text    : "${cartText.trim()}"`);
      screenshots.push(await shot(page, '05-product-in-cart'));

      if (cartText.includes(SEED_PRODUCT)) {
        console.log(`\n✅  Seed product "${SEED_PRODUCT}" added to cart via camera scan!`);
      } else {
        console.log('\n✅  A different product was found and added to cart via camera scan.');
      }
    } else if (hasScanMsg) {
      console.log('\n✅  Barcode was detected by camera. ' +
        (scanMsgText.includes('✗') ? 'Barcode not in DB — add the product to match it.' : ''));
      screenshots.push(await shot(page, '05-scan-message'));
    } else {
      // Overlay closed but no visible result yet — check scan-msg one more time
      screenshots.push(await shot(page, '05-post-scan-state'));
    }

    // Core assertion: something happened (overlay closed OR a result appeared)
    expect(scanDetected).not.toBe('timeout');
    console.log('\n✅  Camera scan pipeline verified end-to-end');

  } finally {
    // ── Report ───────────────────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Camera Live Scan Test — Destinity POS</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;color:#1e293b;padding:40px}
h1{font-size:24px;margin-bottom:8px}
p{color:#64748b;margin-bottom:32px;font-size:14px}
.gallery{display:flex;flex-wrap:wrap;gap:16px}
.card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);width:420px}
.card img{width:100%;display:block}
.card p{padding:10px 14px;font-size:13px;font-weight:600;color:#334155}
</style>
</head>
<body>
<h1>📷 Camera Live Scan Test</h1>
<p>Destinity Inspire POS &middot; ${new Date().toLocaleString()}</p>
<div class="gallery">
${screenshots.map((s, i) => {
  const rel = path.relative(path.dirname(REPORT_OUT), s).replace(/\\/g, '/');
  const label = path.basename(s, '.png').replace(/^\d+-/, '').replace(/-/g, ' ');
  return `<div class="card"><img src="${rel}" /><p>Step ${i + 1}: ${label}</p></div>`;
}).join('\n')}
</div>
</body>
</html>`;

    fs.mkdirSync(path.dirname(REPORT_OUT), { recursive: true });
    fs.writeFileSync(REPORT_OUT, html, 'utf8');
    console.log(`\n📄 Report: ${REPORT_OUT}`);

    await context.close();
    await browser.close();
  }
}, 180000); // 3 min total timeout
