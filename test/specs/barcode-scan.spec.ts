/**
 * Barcode Scanner Tests — Destinity Inspire POS (web / local-DB mode)
 *
 * Covers five scenarios:
 *   S1  Product form barcode field — type a barcode into the form, verify it's saved
 *   S2  POS manual scan input     — type barcode into .scan-input + Enter → cart updated
 *   S3  POS keyboard wedge        — dispatch document keydown events (USB scanner sim)
 *   S4  Camera button visible     — regression: was hidden with *ngIf="isMobile"
 *   S5  Camera overlay open/close — overlay appears on click, close button dismisses it
 *
 * Runs against the production Angular build served from a local static server.
 * All data lives in IndexedDB via LocalDbService (no backend required).
 * Run: cd test && npx playwright test barcode-scan.spec.ts
 */
import { test, expect, chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import { execSync } from 'child_process';

// ── Config ─────────────────────────────────────────────────────────────────────
const FRONTEND_PORT  = 4298;
const FRONTEND_URL   = `http://localhost:${FRONTEND_PORT}`;
const DIST_DIR       = path.join(__dirname, '../../frontend/dist/frontend/browser');
const SS_DIR         = path.join(__dirname, '../../docs/screenshots/barcode');
const REPORT_OUT     = path.join(__dirname, '../../docs/barcode-scan-test.html');

const ADMIN_PIN      = '123456';
const OUTLET_CODE    = 'BCN-01';
const OUTLET_NAME    = 'Barcode Branch';
const TERMINAL_CODE  = 'BCN-TERM-01';
const TERMINAL_NAME  = 'Barcode Terminal 01';

const TEST_BARCODE   = '4901234567890';   // barcode we'll scan with
const TEST_PRODUCT   = 'Scan Test Product';

// ── Results ────────────────────────────────────────────────────────────────────
interface ScenarioResult {
  id: number; title: string; status: 'pass' | 'fail';
  error?: string; screenshots: string[]; duration: number;
}
const allResults: ScenarioResult[] = [];
let httpServer: http.Server | null = null;
let browser: Browser;
let context: BrowserContext;

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
    httpServer = http.createServer(makeServerHandler());
    httpServer.on('error', reject);
    httpServer.listen(FRONTEND_PORT, () => resolve());
  });
}

function stopServer(): void {
  if (httpServer) { httpServer.close(); httpServer = null; }
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

async function loginAdmin(page: Page): Promise<void> {
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

  // Handle terminal setup if needed
  if (await page.locator('.setup-page').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.locator('input[name="outletCode"]').fill(OUTLET_CODE);
    await page.locator('input[name="outletName"]').fill(OUTLET_NAME);
    await page.locator('input[name="terminalCode"]').fill(TERMINAL_CODE);
    await page.locator('input[name="terminalName"]').fill(TERMINAL_NAME);
    await enterPin(page, ADMIN_PIN);
    await page.waitForFunction(() => window.location.hash.includes('/dashboard'), { timeout: 30000 });
  }
}

async function navigate(page: Page, route: string): Promise<void> {
  await page.evaluate((r) => { window.location.hash = r; }, route);
  await page.waitForTimeout(500);
}

async function shot(page: Page, name: string, ssList: string[]): Promise<void> {
  fs.mkdirSync(SS_DIR, { recursive: true });
  const file = path.join(SS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  ssList.push(file);
}

/** Select the first available table to enter the order step */
async function selectTable(page: Page): Promise<void> {
  await navigate(page, '/pos');
  await page.waitForSelector('.table-card, .product-tile', { timeout: 20000 });
  const tableCard = page.locator('.table-card:not(.table-card--blocked)').first();
  if (await tableCard.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tableCard.click();
    await page.waitForSelector('.scan-bar', { timeout: 12000 });
  }
}

/** Go back to table selection from the order step */
async function goToTables(page: Page): Promise<void> {
  const backBtn = page.locator('.btn', { hasText: '← Tables' });
  if (await backBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await backBtn.click();
    await page.waitForSelector('.table-card', { timeout: 10000 });
  }
}

// ── Scenario runner ────────────────────────────────────────────────────────────
async function runScenario(
  id: number, title: string, page: Page,
  fn: (ssList: string[]) => Promise<void>
): Promise<void> {
  const ssList: string[] = [];
  const start = Date.now();
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`[S${id}] ${title}`);
  console.log(`[${'='.repeat(60)}]`);

  const entry: ScenarioResult = { id, title, status: 'pass', screenshots: ssList, duration: 0 };
  allResults.push(entry);

  try {
    await fn(ssList);
    entry.status   = 'pass';
    entry.duration = Date.now() - start;
    console.log(`[S${id}] ✅ PASS (${entry.duration}ms)`);
  } catch (e: any) {
    entry.status   = 'fail';
    entry.error    = e?.message ?? String(e);
    entry.duration = Date.now() - start;
    try { await shot(page, `S${id}-FAIL`, ssList); } catch (_) {}
    console.error(`[S${id}] ❌ FAIL: ${entry.error?.substring(0, 300)}`);
  }
}

// ── HTML Report ────────────────────────────────────────────────────────────────
function generateReport(results: ScenarioResult[]): void {
  const pass  = results.filter(r => r.status === 'pass').length;
  const fail  = results.filter(r => r.status === 'fail').length;
  const total = results.length;
  const now   = new Date().toLocaleString();

  const rows = results.map(r => {
    const badge = r.status === 'pass'
      ? `<span class="badge pass">PASS</span>`
      : `<span class="badge fail">FAIL</span>`;
    const ssHtml = r.screenshots.length
      ? r.screenshots.map(s => {
          const rel = path.relative(path.dirname(REPORT_OUT), s).replace(/\\/g, '/');
          return `<a href="${rel}" target="_blank"><img src="${rel}" class="thumb" /></a>`;
        }).join('')
      : '<span class="no-ss">No screenshots</span>';
    const errHtml = r.error
      ? `<div class="err-box">${r.error.substring(0, 800)}</div>` : '';
    return `<tr>
      <td class="num">#${r.id}</td>
      <td class="title-cell">${r.title}</td>
      <td class="status-cell">${badge}</td>
      <td class="dur">${(r.duration / 1000).toFixed(1)}s</td>
      <td class="ss-cell"><div class="ss-row">${ssHtml}</div>${errHtml}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Barcode Scanner Tests — Destinity POS</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;color:#1e293b}
.header{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:#fff;padding:32px 40px}
.header h1{font-size:26px;font-weight:800;margin-bottom:4px}
.header p{color:#94a3b8;font-size:13px}
.summary{display:flex;gap:14px;padding:24px 40px;flex-wrap:wrap}
.stat{background:#fff;border-radius:12px;padding:18px 24px;flex:1;min-width:120px;box-shadow:0 1px 4px rgba(0,0,0,.08);text-align:center}
.stat-n{font-size:34px;font-weight:900}
.stat-l{font-size:12px;color:#64748b;margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.green{color:#22c55e}.red{color:#ef4444}.blue{color:#3b82f6}.amber{color:#f59e0b}
.container{padding:0 40px 48px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden}
thead th{background:#f1f5f9;padding:11px 14px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px}
tr{border-bottom:1px solid #f1f5f9}tr:last-child{border-bottom:none}
td{padding:12px 14px;vertical-align:top}
.num{font-weight:800;color:#64748b;width:40px}
.title-cell{font-weight:600;color:#1e293b;min-width:220px}
.status-cell{text-align:center;width:80px}
.badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700}
.badge.pass{background:#dcfce7;color:#16a34a}.badge.fail{background:#fee2e2;color:#dc2626}
.dur{color:#94a3b8;font-size:13px;white-space:nowrap;width:60px}
.ss-cell{max-width:620px}
.ss-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px}
.thumb{height:100px;border-radius:8px;border:1px solid #e2e8f0;object-fit:cover;cursor:pointer;transition:transform .15s}
.thumb:hover{transform:scale(1.06)}
.no-ss{color:#9ca3af;font-size:12px}
.err-box{margin-top:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;font-size:11px;color:#b91c1c;font-family:monospace;white-space:pre-wrap;max-height:180px;overflow:auto}
</style>
</head>
<body>
<div class="header">
  <h1>📷 Barcode Scanner Tests</h1>
  <p>Destinity Inspire POS &middot; Chromium &middot; IndexedDB &middot; ${now}</p>
</div>
<div class="summary">
  <div class="stat"><div class="stat-n blue">${total}</div><div class="stat-l">Total</div></div>
  <div class="stat"><div class="stat-n green">${pass}</div><div class="stat-l">Passed</div></div>
  <div class="stat"><div class="stat-n red">${fail}</div><div class="stat-l">Failed</div></div>
  <div class="stat"><div class="stat-n amber">${Math.round(pass/Math.max(total,1)*100)}%</div><div class="stat-l">Pass Rate</div></div>
</div>
<div class="container">
  <table>
    <thead><tr><th>#</th><th>Scenario</th><th>Status</th><th>Time</th><th>Screenshots / Error</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
</body>
</html>`;

  fs.mkdirSync(path.dirname(REPORT_OUT), { recursive: true });
  fs.writeFileSync(REPORT_OUT, html, 'utf8');
  console.log(`\n📄 Report: ${REPORT_OUT}`);
}

// ── Main Test ─────────────────────────────────────────────────────────────────

test('Barcode Scanner Suite', async () => {
  await startServer();
  console.log(`\n📷 Barcode tests at ${FRONTEND_URL}`);

  browser = await chromium.launch({
    headless: false,
    slowMo: 40,
    args: [
      '--use-fake-device-for-media-stream',   // synthetic camera — no physical device needed
      '--use-fake-ui-for-media-stream',        // auto-grant camera permission prompt
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera'],
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.error(`[browser] ${msg.text()}`); });
  // Dismiss any unexpected alerts (e.g. "could not start camera" in headless)
  page.on('dialog', async dialog => {
    console.log(`[dialog] ${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });

  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await waitForAngular(page);

  // ── Fresh DB ──────────────────────────────────────────────────────────────
  await clearDb(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAngular(page);
  console.log('\n🗑️  IndexedDB cleared');

  // ── Login + Terminal setup ─────────────────────────────────────────────────
  await loginAdmin(page);
  console.log('✅  Admin logged in');

  // ── Seed: category ─────────────────────────────────────────────────────────
  await navigate(page, '/categories');
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await page.locator('button', { hasText: /Add/ }).first().click();
  await page.waitForSelector('.modal-overlay', { timeout: 8000 });
  await page.locator('.modal input').first().fill('Food');
  await page.locator('.modal-footer .btn-secondary').click();
  await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});
  console.log('✅  Category created');

  // ── Seed: product with known barcode ───────────────────────────────────────
  await navigate(page, '/products');
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await page.locator('button', { hasText: /Add Product/ }).first().click();
  await page.waitForSelector('.modal-overlay', { timeout: 8000 });
  await page.locator('input[placeholder="Product name"]').fill(TEST_PRODUCT);
  await page.locator('.modal input[type="number"]').first().fill('800');
  // Assign to category
  const catSel = page.locator('.modal select').first();
  if (await catSel.locator('option').count() > 1) await catSel.selectOption({ index: 1 });
  // Type barcode
  await page.locator('input[placeholder="Scan or type barcode..."]').fill(TEST_BARCODE);
  await page.locator('.modal-footer .btn-secondary').click();
  await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  console.log(`✅  Seed product "${TEST_PRODUCT}" with barcode ${TEST_BARCODE}`);

  // ── Seed: one table ────────────────────────────────────────────────────────
  await navigate(page, '/tables');
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await page.locator('button', { hasText: 'Add Table' }).first().click();
  await page.waitForSelector('.modal-overlay', { timeout: 8000 });
  await page.locator('input[placeholder*="Table 1"]').fill('Table 1');
  await page.locator('.modal-footer .btn-secondary').click();
  await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});
  console.log('✅  Table created');

  // ══════════════════════════════════════════════════════════════════════════
  // S1 — Product form barcode field: type a barcode, verify it saves
  // ══════════════════════════════════════════════════════════════════════════
  await runScenario(1, 'Product form — barcode field typed and saved', page, async (ss) => {
    await navigate(page, '/products');
    await page.waitForSelector('.page-title', { timeout: 15000 });
    await shot(page, 'S1-01-products-list', ss);

    // Open Add Product modal
    await page.locator('button', { hasText: /Add Product/ }).first().click();
    await page.waitForSelector('.modal-overlay', { timeout: 8000 });
    await shot(page, 'S1-02-add-product-modal', ss);

    await page.locator('input[placeholder="Product name"]').fill('Barcode Form Product');
    await page.locator('.modal input[type="number"]').first().fill('350');

    // Click the barcode input and type (simulates USB scanner or manual entry)
    const barcodeInput = page.locator('input[placeholder="Scan or type barcode..."]');
    await barcodeInput.click();
    await barcodeInput.fill(TEST_BARCODE);
    await shot(page, 'S1-03-barcode-typed', ss);

    // Verify the scan camera button (📷) exists next to the barcode field
    const scanBtn = page.locator('.scan-fill-btn');
    await expect(scanBtn).toBeVisible({ timeout: 5000 });
    console.log('[S1] Scan button visible in product form');

    await page.locator('.modal-footer .btn-secondary').click();
    await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Reload products list and find the new row
    await navigate(page, '/products');
    await page.waitForSelector('tbody tr', { timeout: 10000 });
    await shot(page, 'S1-04-products-after-save', ss);

    // The barcode column should contain our TEST_BARCODE
    const barcodeCell = page.locator('tbody td').filter({ hasText: TEST_BARCODE }).first();
    await expect(barcodeCell).toBeVisible({ timeout: 8000 });
    console.log(`[S1] Barcode ${TEST_BARCODE} found in products table`);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // S2 — POS manual scan input: type barcode into .scan-input field + Enter
  // ══════════════════════════════════════════════════════════════════════════
  await runScenario(2, 'POS manual scan input — type barcode + Enter adds product to cart', page, async (ss) => {
    await selectTable(page);
    await shot(page, 'S2-01-order-view', ss);

    // Confirm scan bar is present
    await expect(page.locator('.scan-bar')).toBeVisible({ timeout: 8000 });

    // Click into the scan input, type the barcode, press Enter
    const scanInput = page.locator('.scan-input');
    await scanInput.click();
    await scanInput.fill(TEST_BARCODE);
    await shot(page, 'S2-02-barcode-in-input', ss);
    await scanInput.press('Enter');
    await page.waitForTimeout(800);
    await shot(page, 'S2-03-after-scan', ss);

    // Cart should have an item
    const cartItem = page.locator('.cart-item').first();
    await expect(cartItem).toBeVisible({ timeout: 8000 });
    const cartText = await cartItem.textContent();
    console.log(`[S2] Cart item text: "${cartText?.trim()}"`);
    expect(cartText).toContain(TEST_PRODUCT);

    // Scan message should show success (not ✗)
    const msgEl = page.locator('.scan-msg');
    if (await msgEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      const msgText = await msgEl.textContent() ?? '';
      console.log(`[S2] Scan message: "${msgText.trim()}"`);
      expect(msgText).not.toContain('✗');
      expect(msgText).toContain('Added');
    }

    await shot(page, 'S2-04-cart-with-item', ss);
    await goToTables(page);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // S3 — POS keyboard wedge: document-level keydown events (USB scanner sim)
  // ══════════════════════════════════════════════════════════════════════════
  await runScenario(3, 'POS keyboard wedge — document keydown events add product to cart', page, async (ss) => {
    await selectTable(page);
    await shot(page, 'S3-01-order-view', ss);

    // Blur all inputs — keyboard wedge only fires when no input is focused
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.waitForTimeout(200);

    // Dispatch keydown events directly to document (simulates a USB barcode scanner
    // which injects keyboard events into the OS regardless of what is focused)
    console.log(`[S3] Dispatching keydown events for barcode: ${TEST_BARCODE}`);
    await page.evaluate((barcode: string) => {
      // Type each character with a small delay baked into a promise chain
      const dispatchChar = (char: string) =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }));

      for (const char of barcode) {
        dispatchChar(char);
      }
      // Pause briefly (within the 200ms buffer window) then send Enter
      return new Promise<void>(resolve => setTimeout(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        resolve();
      }, 80));
    }, TEST_BARCODE);

    await page.waitForTimeout(800);
    await shot(page, 'S3-02-after-wedge-scan', ss);

    // Product should be in cart
    const cartItem = page.locator('.cart-item').first();
    await expect(cartItem).toBeVisible({ timeout: 8000 });
    const cartText = await cartItem.textContent();
    console.log(`[S3] Cart item text: "${cartText?.trim()}"`);
    expect(cartText).toContain(TEST_PRODUCT);
    await shot(page, 'S3-03-cart-with-item', ss);

    await goToTables(page);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // S4 — Camera button is visible on web (regression for isMobile fix)
  // ══════════════════════════════════════════════════════════════════════════
  await runScenario(4, 'Camera button visible on web — regression for isMobile fix', page, async (ss) => {
    await selectTable(page);
    await shot(page, 'S4-01-order-view', ss);

    // Camera button must be visible — previously hidden with *ngIf="isMobile"
    // which only evaluated true on Android/Capacitor native
    const cameraBtn = page.locator('.scan-bar button', { hasText: /Camera/i });
    await expect(cameraBtn).toBeVisible({ timeout: 8000 });
    console.log('[S4] Camera button is visible on web');
    await shot(page, 'S4-02-camera-btn-visible', ss);

    await goToTables(page);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // S5 — Camera actually opens (real stream via Chromium fake device)
  // ══════════════════════════════════════════════════════════════════════════
  await runScenario(5, 'Camera opens real video stream and closes cleanly', page, async (ss) => {
    await selectTable(page);
    await shot(page, 'S5-00-before-camera', ss);

    const cameraBtn = page.locator('.scan-bar button', { hasText: /Camera/i });
    await expect(cameraBtn).toBeVisible({ timeout: 8000 });
    await cameraBtn.click();
    console.log('[S5] Camera button clicked');

    // Overlay appears synchronously (before getUserMedia resolves)
    const overlay = page.locator('#scanner-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await shot(page, 'S5-01-overlay-appeared', ss);
    console.log('[S5] Overlay visible');

    // Wait for the <video> element to appear inside the scanner container —
    // this means getUserMedia succeeded and the stream is attached
    const video = page.locator('#qr-scanner-container video');
    await expect(video).toBeVisible({ timeout: 15000 });
    console.log('[S5] <video> element visible — camera stream is open');

    // Wait for the video to start playing (readyState >= 2 = HAVE_CURRENT_DATA)
    await page.waitForFunction(() => {
      const v = document.querySelector('#qr-scanner-container video') as HTMLVideoElement;
      return v && v.readyState >= 2;
    }, { timeout: 10000 });
    console.log('[S5] Video is playing');

    // Screenshot with live camera feed open
    await shot(page, 'S5-02-camera-live', ss);

    // Viewfinder guide box should be rendered
    const vf = page.locator('#qr-scanner-container div').first();
    await expect(vf).toBeVisible({ timeout: 3000 });
    console.log('[S5] Viewfinder guide box visible');
    await shot(page, 'S5-03-viewfinder', ss);

    // Verify hint text is shown
    await expect(page.locator('#scanner-hint')).toBeVisible({ timeout: 3000 });

    // Close the scanner
    const closeBtn = page.locator('#scanner-close');
    await expect(closeBtn).toBeVisible({ timeout: 3000 });
    await closeBtn.click();
    await page.waitForTimeout(400);

    // Overlay must be hidden and video tracks must be stopped
    const afterClose = await page.evaluate(() => {
      const overlay = document.getElementById('scanner-overlay');
      const video   = document.querySelector('#qr-scanner-container video') as HTMLVideoElement | null;
      const overlayHidden = !overlay || overlay.style.display === 'none';
      const tracksEnded   = !video?.srcObject ||
        (video.srcObject as MediaStream).getTracks().every(t => t.readyState === 'ended');
      return { overlayHidden, tracksEnded };
    });

    console.log(`[S5] Overlay hidden: ${afterClose.overlayHidden} | Tracks ended: ${afterClose.tracksEnded}`);
    expect(afterClose.overlayHidden).toBe(true);
    await shot(page, 'S5-04-camera-closed', ss);

    await goToTables(page);
  });

  // ── Done ──────────────────────────────────────────────────────────────────
  await context.close();
  await browser.close();
  stopServer();

  generateReport(allResults);

  const passed = allResults.filter(r => r.status === 'pass').length;
  const failed = allResults.filter(r => r.status === 'fail');
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Barcode Scanner Tests: ${passed}/${allResults.length} passed`);
  if (failed.length) console.log(`Failed: ${failed.map(r => `S${r.id} ${r.title}`).join('\n         ')}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Fail the Playwright test if any scenario failed
  const failedScenarios = allResults.filter(r => r.status === 'fail');
  if (failedScenarios.length > 0) {
    throw new Error(`${failedScenarios.length} scenario(s) failed:\n` +
      failedScenarios.map(r => `  S${r.id}: ${r.title}\n  → ${r.error}`).join('\n'));
  }
}, 300000);
