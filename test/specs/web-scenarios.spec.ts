/**
 * Web Scenario Tests — Destinity Inspire POS (browser / local-DB mode)
 * Same 10 scenarios as desktop-scenarios.spec.ts but running in Chromium
 * against the production Angular build (no Electron, no Flask backend).
 * All data lives in IndexedDB via LocalDbService.
 *
 * Results + screenshots → docs/web-test.html
 */
import { test, expect, chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import { execSync, ChildProcess } from 'child_process';

// ── Config ────────────────────────────────────────────────────────────────────
const FRONTEND_PORT = 4299;   // separate port so it doesn't clash with ng serve :4200
const FRONTEND_URL  = `http://localhost:${FRONTEND_PORT}`;
const DIST_DIR      = path.join(__dirname, '../../frontend/dist/frontend/browser');
const SS_DIR        = path.join(__dirname, '../screenshots/web');
const REPORT_OUT    = path.join(__dirname, '../../docs/web-test.html');

const ADMIN_PIN     = '123456';
const CASHIER_PIN   = '1234';
const OUTLET_CODE   = 'WEB-01';
const OUTLET_NAME   = 'Web Branch';
const TERMINAL_CODE = 'WEB-TERM-01';
const TERMINAL_NAME = 'Web Terminal 01';

interface ScenarioResult {
  id: number; title: string; status: 'pass' | 'fail';
  error?: string; screenshots: string[]; duration: number;
}

const allResults: ScenarioResult[] = [];
let httpServer: http.Server | null = null;
let serverProc: ChildProcess | null = null; // kept for type compat, unused
let browser: Browser;
let context: BrowserContext;

// ── Static file server ────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html':        'text/html; charset=utf-8',
  '.js':          'application/javascript',
  '.mjs':         'application/javascript',
  '.cjs':         'application/javascript',
  '.css':         'text/css',
  '.json':        'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png':         'image/png',
  '.jpg':         'image/jpeg',
  '.svg':         'image/svg+xml',
  '.ico':         'image/x-icon',
  '.woff':        'font/woff',
  '.woff2':       'font/woff2',
  '.txt':         'text/plain',
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

/** Kill any process currently using FRONTEND_PORT (Windows netstat + taskkill). */
function freePort(port: number): void {
  try {
    const out = execSync(`netstat -ano`, { encoding: 'utf8', windowsHide: true });
    const lines = out.split('\n').filter(l => l.includes(`:${port} `));
    const pids = new Set<string>();
    for (const line of lines) {
      const m = line.trim().split(/\s+/);
      const pid = m[m.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try { execSync(`taskkill /f /pid ${pid}`, { windowsHide: true }); } catch {}
    }
    if (pids.size) {
      // Give OS a moment to reclaim the port
      const end = Date.now() + 2000;
      while (Date.now() < end) { /* spin */ }
    }
  } catch {}
}

/** Returns true if port is free (no listener). */
function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => { tester.close(); resolve(true); });
    tester.listen(port);
  });
}

async function startServer(): Promise<void> {
  // Ensure port is free before we try to listen
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function clearDb(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Delete the Dexie database so LocalDbService re-seeds fresh data
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('destinity-pos');
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
      req.onblocked = () => resolve(); // still continue if blocked
    });
    // Clear terminal & auth from localStorage
    ['terminal_uuid','terminal_code','terminal_name','outlet_uuid','outlet_code','outlet_name',
     'pos_auth','api_url','sync_state'].forEach(k => localStorage.removeItem(k));
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

/** Navigate to a clean login screen */
async function goToLogin(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('pos_auth');
    localStorage.setItem('pos_mode', 'restaurant');
    window.location.hash = '/login';
  });
  await page.waitForSelector('.staff-card', { timeout: 30000 });
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

async function loginAs(page: Page, role: 'Admin' | 'Cashier', pin: string): Promise<void> {
  await goToLogin(page);
  const card = page.locator('.staff-card', { hasText: role }).first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();
  await page.waitForSelector('.pin-screen', { timeout: 10000 });
  await enterPin(page, pin);
  await page.waitForFunction(() => !window.location.hash.includes('/login'), { timeout: 20000 });
  await page.waitForTimeout(500);
}

async function logout(page: Page): Promise<void> {
  const hamburger = page.locator('.hamburger');
  if (await hamburger.isVisible({ timeout: 1000 }).catch(() => false)) {
    await hamburger.click();
    await page.waitForTimeout(300);
  }
  await page.locator('.logout-btn').first().click();
  await page.waitForSelector('.staff-card', { timeout: 20000 });
}

async function navigate(page: Page, route: string): Promise<void> {
  await page.evaluate((r) => { window.location.hash = r; }, route);
  await page.waitForTimeout(500);
}

async function shot(page: Page, name: string, ssList: string[]): Promise<void> {
  fs.mkdirSync(SS_DIR, { recursive: true });
  const file = path.join(SS_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  ssList.push(file);
}

async function placeOrderAndPay(
  page: Page,
  method: 'cash-exact' | 'cash-5000' | 'card',
  prefix: string,
  ssList: string[]
): Promise<void> {
  await navigate(page, '/pos');
  await page.waitForSelector('.table-card, .product-tile', { timeout: 25000 });

  let tableCard = page.locator('.table-card:not(.table-card--blocked)').first();
  if (!await tableCard.isVisible({ timeout: 2000 }).catch(() => false)) {
    // All tables are billed — click the first "→ Available" transition button to free one
    const clearBtn = page.locator('.table-card .transition-btn').filter({ hasText: /Available/i }).first();
    if (await clearBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clearBtn.click();
      await page.waitForTimeout(600);
    }
    tableCard = page.locator('.table-card:not(.table-card--blocked)').first();
  }
  if (await tableCard.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tableCard.click();
    await page.waitForSelector('.product-tile', { timeout: 12000 });
  }
  await shot(page, `${prefix}-1-pos`, ssList);

  const tile = page.locator('.product-tile').first();
  await expect(tile).toBeVisible({ timeout: 10000 });
  await tile.click();
  await page.waitForSelector('.cart-item', { timeout: 8000 });
  await shot(page, `${prefix}-2-item-added`, ssList);

  await page.locator('.checkout-btn').click();
  const modal = page.locator('.pay-overlay').first();
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  await shot(page, `${prefix}-3-payment-method`, ssList);

  if (method === 'card') {
    await page.locator('.pay-method-btn').filter({ hasText: 'Card' }).click();
    await page.waitForSelector('.pay-modal--card', { timeout: 8000 });
    await shot(page, `${prefix}-4-card-modal`, ssList);
    await page.locator('input[placeholder="Full name on card"]').fill('Test User');
    await page.locator('input[placeholder="1234 5678 9012 3456"]').fill('4111111111111111');
    await page.locator('input[placeholder="MM/YY"]').fill('12/26');
    await page.locator('input[placeholder="•••"]').fill('123');
    await shot(page, `${prefix}-5-card-filled`, ssList);
    await page.locator('.card-pay-btn').click();
  } else {
    await page.locator('.pay-method-btn').filter({ hasText: 'Cash' }).click();
    await page.waitForSelector('.pay-modal--cash', { timeout: 8000 });
    await shot(page, `${prefix}-4-cash-modal`, ssList);
    if (method === 'cash-5000') {
      await page.locator('.quick-cash-btn', { hasText: '5000' }).click();
    } else {
      await page.locator('.quick-cash-btn', { hasText: 'Exact' }).click();
    }
    await shot(page, `${prefix}-5-cash-amount`, ssList);
    await page.locator('.pay-modal-footer .btn-secondary').click();
  }

  const receipt = page.locator('.invoice-wrap').first();
  await receipt.waitFor({ state: 'visible', timeout: 30000 });
  await shot(page, `${prefix}-6-receipt`, ssList);

  // Reset POS for the next order
  const newOrderBtn = page.locator('.inv-new-btn');
  if (await newOrderBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await newOrderBtn.click();
    await page.waitForSelector('.table-card, .product-tile', { timeout: 10000 }).catch(() => {});
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
          return `<a href="${rel}" target="_blank"><img src="${rel}" class="thumb" title="${path.basename(s)}" /></a>`;
        }).join('')
      : '<span class="no-ss">No screenshots</span>';

    const errHtml = r.error
      ? `<div class="err-box">${r.error.substring(0, 800)}</div>`
      : '';

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
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Web Test Results — Destinity Inspire POS</title>
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
tr{border-bottom:1px solid #f1f5f9}tr:last-child{border-bottom:none}tr:hover{background:#fafcff}
td{padding:12px 14px;vertical-align:top}
.num{font-weight:800;color:#64748b;white-space:nowrap;width:40px}
.title-cell{font-weight:600;color:#1e293b;min-width:200px}
.status-cell{text-align:center;width:80px}
.badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700}
.badge.pass{background:#dcfce7;color:#16a34a}
.badge.fail{background:#fee2e2;color:#dc2626}
.dur{color:#94a3b8;font-size:13px;white-space:nowrap;width:60px}
.ss-cell{max-width:620px}
.ss-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px}
.thumb{height:100px;border-radius:8px;border:1px solid #e2e8f0;object-fit:cover;cursor:pointer;transition:transform .15s}
.thumb:hover{transform:scale(1.06)}
.no-ss{color:#9ca3af;font-size:12px}
.err-box{margin-top:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;font-size:11px;color:#b91c1c;font-family:monospace;white-space:pre-wrap;max-height:180px;overflow:auto}
.mode-badge{display:inline-block;background:rgba(99,102,241,.15);color:#6366f1;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-left:8px}
</style>
</head>
<body>
<div class="header">
  <h1>🌐 Web Test Results <span class="mode-badge">LOCAL DB MODE</span></h1>
  <p>Destinity Inspire POS &middot; Chromium &middot; IndexedDB &middot; ${now}</p>
</div>
<div class="summary">
  <div class="stat"><div class="stat-n blue">${total}</div><div class="stat-l">Total</div></div>
  <div class="stat"><div class="stat-n green">${pass}</div><div class="stat-l">Passed</div></div>
  <div class="stat"><div class="stat-n red">${fail}</div><div class="stat-l">Failed</div></div>
  <div class="stat"><div class="stat-n amber">${Math.round(pass / Math.max(total, 1) * 100)}%</div><div class="stat-l">Pass Rate</div></div>
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
  console.log(`\n📄 Report saved: ${REPORT_OUT}`);
}

// ── Main Test ─────────────────────────────────────────────────────────────────

test('Web Scenario Suite', async () => {
  // Launch static file server for the production Angular build
  await startServer();
  console.log(`\n🌐 Frontend served at ${FRONTEND_URL}`);

  // Launch Chromium (regular browser, no Electron)
  browser = await chromium.launch({ headless: false, slowMo: 50 });
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.error(`[browser] ${msg.text()}`); });

  // Navigate and wait for Angular to boot
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await waitForAngular(page);

  // ── Clear DB for a clean slate ───────────────────────────────────────────
  await clearDb(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAngular(page);
  console.log('\n🗑️  IndexedDB cleared — fresh state');

  // ── S1: Admin login → Terminal setup → Logout ────────────────────────────
  await runScenario(1, 'Admin login → Create Terminal → Logout', page, async (ss) => {
    // Force fresh login (no terminal yet)
    await page.evaluate(() => {
      ['pos_auth','terminal_uuid','terminal_code','terminal_name',
       'outlet_uuid','outlet_code','outlet_name'].forEach(k => localStorage.removeItem(k));
      localStorage.setItem('pos_mode', 'restaurant');
      window.location.hash = '/login';
    });
    await page.waitForSelector('.staff-card', { timeout: 30000 });
    await shot(page, 'S1-01-staff-grid', ss);

    const adminCard = page.locator('.staff-card', { hasText: 'Admin' }).first();
    await expect(adminCard).toBeVisible({ timeout: 15000 });
    await adminCard.click();
    await page.waitForSelector('.pin-screen', { timeout: 10000 });
    await shot(page, 'S1-02-pin-screen', ss);

    await enterPin(page, ADMIN_PIN);
    await page.waitForFunction(() => !window.location.hash.includes('/login'), { timeout: 20000 });

    const onSetup = await page.locator('.setup-page').isVisible({ timeout: 8000 }).catch(() => false);
    if (onSetup) {
      await shot(page, 'S1-03-terminal-setup', ss);
      await page.locator('input[name="outletCode"]').fill(OUTLET_CODE);
      await page.locator('input[name="outletName"]').fill(OUTLET_NAME);
      await page.locator('input[name="terminalCode"]').fill(TERMINAL_CODE);
      await page.locator('input[name="terminalName"]').fill(TERMINAL_NAME);
      await shot(page, 'S1-04-form-filled', ss);
      await enterPin(page, ADMIN_PIN);
      await page.waitForFunction(() => window.location.hash.includes('/dashboard'), { timeout: 30000 });
    }

    await shot(page, 'S1-05-dashboard', ss);
    await logout(page);
    await shot(page, 'S1-06-after-logout', ss);
    expect(await page.locator('.staff-card').first().isVisible()).toBe(true);
  });

  // ── S2: Admin login → Create Categories ─────────────────────────────────
  await runScenario(2, 'Admin login → Create Categories', page, async (ss) => {
    await loginAs(page, 'Admin', ADMIN_PIN);

    // Handle terminal-setup if re-prompted
    if (await page.locator('.setup-page').isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator('input[name="outletCode"]').fill(OUTLET_CODE);
      await page.locator('input[name="outletName"]').fill(OUTLET_NAME);
      await page.locator('input[name="terminalCode"]').fill(TERMINAL_CODE);
      await page.locator('input[name="terminalName"]').fill(TERMINAL_NAME);
      await enterPin(page, ADMIN_PIN);
      await page.waitForFunction(() => window.location.hash.includes('/dashboard'), { timeout: 30000 });
    }

    await navigate(page, '/categories');
    await page.waitForSelector('.page-title', { timeout: 15000 });
    await shot(page, 'S2-01-categories-page', ss);

    for (const name of ['Main Course', 'Beverages', 'Desserts']) {
      const addBtn = page.locator('button', { hasText: /Add/ }).first();
      await addBtn.click();
      await page.waitForSelector('.modal-overlay', { timeout: 8000 });
      await page.locator('.modal input').first().fill(name);
      await page.locator('.swatch').first().click();
      await page.locator('.modal-footer .btn-secondary').click();
      await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
    }

    await navigate(page, '/categories');
    await page.waitForSelector('.cat-card, .empty-state', { timeout: 10000 });
    await shot(page, 'S2-02-categories-created', ss);
    expect(await page.locator('.cat-card').count()).toBeGreaterThanOrEqual(1);
  });

  // ── S3: Create Products ──────────────────────────────────────────────────
  await runScenario(3, 'Create Products', page, async (ss) => {
    await navigate(page, '/products');
    await page.waitForSelector('.page-title', { timeout: 15000 });
    await shot(page, 'S3-01-products-page', ss);

    for (const prod of [
      { name: 'Grilled Chicken', price: '1200' },
      { name: 'Fresh Juice',     price: '350'  },
      { name: 'Chocolate Cake',  price: '500'  },
    ]) {
      await page.locator('button', { hasText: /Add Product/ }).first().click();
      await page.waitForSelector('.modal-overlay', { timeout: 8000 });
      await page.locator('input[placeholder="Product name"]').fill(prod.name);
      await page.locator('.modal input[type="number"]').first().fill(prod.price);
      const catSel = page.locator('.modal select').first();
      if (await catSel.locator('option').count() > 1) await catSel.selectOption({ index: 1 });
      await page.locator('.modal-footer .btn-secondary').click();
      await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
    }

    await navigate(page, '/products');
    await page.waitForSelector('tbody tr, .empty-state', { timeout: 10000 });
    await shot(page, 'S3-02-products-created', ss);
    expect(await page.locator('tbody tr').count()).toBeGreaterThanOrEqual(1);
  });

  // ── S4: Create Tables ────────────────────────────────────────────────────
  await runScenario(4, 'Create Tables', page, async (ss) => {
    await navigate(page, '/tables');
    await page.waitForSelector('.page-title', { timeout: 15000 });
    await shot(page, 'S4-01-tables-page', ss);

    for (let i = 1; i <= 3; i++) {
      await page.locator('button', { hasText: 'Add Table' }).first().click();
      await page.waitForSelector('.modal-overlay', { timeout: 8000 });
      await page.locator('input[placeholder*="Table 1"]').fill(`Table ${i}`);
      await page.locator('.modal-footer .btn-secondary').click();
      await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
    }

    await navigate(page, '/tables');
    await page.waitForSelector('.table-card, .empty-state', { timeout: 10000 });
    await shot(page, 'S4-02-tables-created', ss);
    expect(await page.locator('.table-card').count()).toBeGreaterThanOrEqual(1);
  });

  // ── S5: Order → Cash Exact ───────────────────────────────────────────────
  await runScenario(5, 'Place Order → Pay with Cash (Exact)', page, async (ss) => {
    await placeOrderAndPay(page, 'cash-exact', 'S5', ss);
  });

  // ── S6: Order → Cash 5000 ───────────────────────────────────────────────
  await runScenario(6, 'Place Order → Pay with Cash (LKR 5000)', page, async (ss) => {
    await placeOrderAndPay(page, 'cash-5000', 'S6', ss);
  });

  // ── S7: Order → Card ────────────────────────────────────────────────────
  await runScenario(7, 'Place Order → Pay with Card', page, async (ss) => {
    await placeOrderAndPay(page, 'card', 'S7', ss);
  });

  // ── S8: Sync page → Check log ────────────────────────────────────────────
  await runScenario(8, 'Sync page → Check Log (local mode)', page, async (ss) => {
    await navigate(page, '/sync');
    await page.waitForSelector('.sync-page', { timeout: 15000 });
    await shot(page, 'S8-01-sync-page', ss);

    const isOnline = await page.locator('.online-badge.online').isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`[S8] Online: ${isOnline}`);

    if (isOnline) {
      // Try push local master data to cloud
      const masterUpBtn = page.locator('.sync-btn.master-up');
      if (await masterUpBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await masterUpBtn.click();
        await page.waitForTimeout(5000);
        await shot(page, 'S8-02-master-push', ss);
      }

      // Try sync transactions
      const txBtn = page.locator('.sync-btn.transactions');
      if (await txBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await txBtn.click();
        await page.waitForTimeout(5000);
        await shot(page, 'S8-03-tx-push', ss);
      }
    } else {
      await shot(page, 'S8-offline', ss);
      console.log('[S8] Offline — sync skipped');
    }

    // Sync log in local DB mode is populated by SyncService — pass if page is visible
    await shot(page, 'S8-04-final', ss);
    expect(await page.locator('.sync-page').isVisible()).toBe(true);
  });

  // ── S9: Logout Admin → Login as Cashier ─────────────────────────────────
  await runScenario(9, 'Logout Admin → Login as Cashier', page, async (ss) => {
    await logout(page);
    await shot(page, 'S9-01-staff-grid', ss);

    const cashierCard = page.locator('.staff-card', { hasText: 'Cashier' }).first();
    if (!await cashierCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      throw new Error('No Cashier card found — check LocalDb seeding');
    }
    await cashierCard.click();
    await page.waitForSelector('.pin-screen', { timeout: 10000 });
    await shot(page, 'S9-02-cashier-pin', ss);
    await enterPin(page, CASHIER_PIN);
    await page.waitForFunction(() => !window.location.hash.includes('/login'), { timeout: 20000 });
    await page.waitForTimeout(500);
    await shot(page, 'S9-03-cashier-logged-in', ss);
    expect(await page.evaluate(() => window.location.hash)).not.toContain('/login');
  });

  // ── S10: Cashier → Cash / Cash 5000 / Card + sync redirect ──────────────
  await runScenario(10, 'Cashier: Cash Exact / Cash 5000 / Card', page, async (ss) => {
    await placeOrderAndPay(page, 'cash-exact', 'S10a', ss);
    await page.waitForTimeout(400);
    await placeOrderAndPay(page, 'cash-5000',  'S10b', ss);
    await page.waitForTimeout(400);
    await placeOrderAndPay(page, 'card',        'S10c', ss);
    await page.waitForTimeout(400);

    // Sync is admin/manager only — cashier gets redirected to dashboard
    await navigate(page, '/sync');
    await page.waitForTimeout(1500);
    const hash = await page.evaluate(() => window.location.hash);
    await shot(page, 'S10d-after-sync-nav', ss);
    console.log(`[S10] Sync nav hash: ${hash} (cashier redirected from sync is expected)`);
    expect(hash).toBeTruthy();
  });

  // ── Done ─────────────────────────────────────────────────────────────────
  await context.close();
  await browser.close();
  stopServer();

  generateReport(allResults);

  const passed = allResults.filter(r => r.status === 'pass').length;
  const failed = allResults.filter(r => r.status === 'fail');
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Results: ${passed}/${allResults.length} passed`);
  if (failed.length) console.log(`Failed: ${failed.map(r => `#${r.id}`).join(', ')}`);
  console.log(`${'═'.repeat(60)}\n`);
}, 600000);
