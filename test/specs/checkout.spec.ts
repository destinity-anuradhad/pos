/**
 * Cross-platform checkout parity tests
 * Runs the SAME checkout flow on Web (localhost:4200) and Electron.
 * Both must produce identical behaviour.
 *
 * App details:
 *  - HashLocationStrategy → routes are /#/pos, /#/dashboard etc.
 *  - Default API is Railway; seed api_url=localhost:8000 so tests are fast
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import type { Page, ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// Force-close Electron; app.close() can hang waiting for Python teardown
async function closeElectron(app: ElectronApplication) {
  await Promise.race([
    app.close(),
    new Promise<void>(resolve => setTimeout(resolve, 5000))  // give 5s then give up
  ]);
  try { app.process().kill(); } catch (_) {}
}

// localStorage seed — bypasses login, mode-select, and forces local API
const SEED: Record<string, string> = {
  pos_auth: 'true',
  pos_mode: 'restaurant',
  api_url:  'http://localhost:8000/api',   // avoid Railway timeout in tests
};

// ── helpers ────────────────────────────────────────────────────────────────

async function seedLocalStorage(page: Page) {
  await page.evaluate((seed) => {
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, SEED);
}

/**
 * Seed localStorage AND reload so Angular re-initialises ApiService.base
 * with the correct api_url (it's a singleton read once at boot).
 */
async function seedAndReload(page: Page) {
  await seedLocalStorage(page);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  // After reload Angular re-reads localStorage — seed again in case it cleared
  await seedLocalStorage(page);
}

/** Navigate to POS using hash routing and wait for content */
async function goToPOS(page: Page) {
  await page.evaluate(() => { window.location.hash = '/pos'; });
  await page.waitForSelector('.table-card, .product-tile', { timeout: 20000 });
}

/** Find the Electron main window (not DevTools) */
async function getMainWindow(app: ElectronApplication): Promise<Page> {
  // DevTools URL starts with devtools://; main window loads Angular
  const waitForMain = async (): Promise<Page> => {
    const windows = app.windows();
    for (const w of windows) {
      const url = w.url();
      if (!url.startsWith('devtools://') && url !== 'about:blank') return w;
    }
    // poll until main window appears
    await new Promise(r => setTimeout(r, 500));
    return waitForMain();
  };
  return waitForMain();
}

async function selectTableIfNeeded(page: Page) {
  const tableCard = page.locator('.table-card--available').first();
  if (await tableCard.isVisible({ timeout: 4000 }).catch(() => false)) {
    await tableCard.click();
    await page.waitForSelector('.product-tile', { timeout: 10000 });
  }
}

// ── checkout flow ──────────────────────────────────────────────────────────
async function runCheckout(page: Page, label: string) {
  fs.mkdirSync('screenshots', { recursive: true });
  console.log(`\n[${label}] ── checkout start ──`);

  await selectTableIfNeeded(page);
  await page.waitForSelector('.product-tile', { timeout: 10000 });
  await page.screenshot({ path: `screenshots/${label}-1-products.png` });

  // Add first product
  const tile = page.locator('.product-tile').first();
  const productName = (await tile.locator('.product-tile-name').textContent() ?? '').trim();
  console.log(`[${label}] Adding: ${productName}`);
  await tile.click();
  await page.waitForSelector('.cart-item', { timeout: 8000 });

  // Checkout button
  await page.locator('.checkout-btn').click();
  await page.screenshot({ path: `screenshots/${label}-2-after-checkout-click.png` });

  // Payment modal — waitFor actually polls until visible
  const modal = page.locator('.pay-overlay').first();
  const modalAppeared = await modal.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  console.log(`[${label}] Modal appeared: ${modalAppeared}`);
  await page.screenshot({ path: `screenshots/${label}-3-modal.png` });

  if (!modalAppeared) {
    return { modalAppeared: false, cashWorked: false, receiptShown: false, receiptPayment: '', receiptTotal: '' };
  }

  // Cash
  const cashBtn = page.locator('.pay-method-btn').filter({ hasText: 'Cash' });
  const cashWorked = await cashBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
  console.log(`[${label}] Cash visible: ${cashWorked}`);
  if (cashWorked) await cashBtn.click();

  // Wait up to 20s for receipt — waitFor actually polls; isVisible() does not
  const receiptShown = await page.locator('.invoice-success')
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true).catch(() => false);
  console.log(`[${label}] Receipt shown: ${receiptShown}`);

  let receiptPayment = '';
  let receiptTotal = '';
  if (receiptShown) {
    await page.screenshot({ path: `screenshots/${label}-4-receipt.png` });
    receiptPayment = (await page.locator('.invoice-meta-item:has-text("Payment") .inv-value').textContent() ?? '').trim();
    receiptTotal   = (await page.locator('.inv-grand-total strong').textContent() ?? '').trim();
    console.log(`[${label}] Payment: "${receiptPayment}"  Total: "${receiptTotal}"`);
  } else {
    await page.screenshot({ path: `screenshots/${label}-4-no-receipt.png` });
  }

  return { modalAppeared, cashWorked, receiptShown, receiptPayment, receiptTotal };
}

// ── Reset all restaurant tables to 'available' before each test ───────────
test.beforeEach(async () => {
  // Fetch all tables then reset each one
  const res = await fetch('http://localhost:8000/api/tables/', {
    headers: { 'X-POS-Mode': 'restaurant' }
  }).catch(() => null);
  if (!res?.ok) return;
  const tables: { id: number }[] = await res.json();
  await Promise.all(tables.map(t =>
    fetch(`http://localhost:8000/api/tables/${t.id}/status?status=available`, {
      method: 'PATCH',
      headers: { 'X-POS-Mode': 'restaurant' }
    }).catch(() => {})
  ));
  console.log(`[setup] Reset ${tables.length} tables to available`);
});

// ── WEB ────────────────────────────────────────────────────────────────────
test('WEB — checkout flow', async ({ page }) => {
  await page.goto('http://localhost:4200', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await seedAndReload(page);
  await goToPOS(page);

  const r = await runCheckout(page, 'WEB');

  expect(r.modalAppeared, 'Web: payment modal must appear').toBe(true);
  expect(r.cashWorked,    'Web: Cash button must be visible').toBe(true);
  expect(r.receiptShown,  'Web: receipt must show after checkout').toBe(true);
  expect(r.receiptPayment,'Web: receipt must say Cash').toContain('Cash');
  expect(r.receiptTotal,  'Web: receipt total must not be empty').not.toBe('');
});

// ── ELECTRON ───────────────────────────────────────────────────────────────
test('ELECTRON — checkout flow', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '../../electron/main.js')],
    cwd: path.join(__dirname, '../../electron'),
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 60000,
  });

  // Get the main app window (skip DevTools)
  const page = await getMainWindow(app);
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: 'screenshots/ELECTRON-0-initial.png' });

  await seedAndReload(page);
  await goToPOS(page);
  await page.screenshot({ path: 'screenshots/ELECTRON-0b-pos.png' });

  const r = await runCheckout(page, 'ELECTRON');
  await page.screenshot({ path: 'screenshots/ELECTRON-final.png' });

  // Assert BEFORE closing — app.close() can hang on Python teardown
  expect(r.modalAppeared, 'Electron: payment modal must appear').toBe(true);
  expect(r.cashWorked,    'Electron: Cash button must be visible').toBe(true);
  expect(r.receiptShown,  'Electron: receipt must show').toBe(true);
  expect(r.receiptPayment,'Electron: payment method must say Cash').toContain('Cash');
  expect(r.receiptTotal,  'Electron: receipt total must not be empty').not.toBe('');

  await closeElectron(app);
});

// ── PARITY ─────────────────────────────────────────────────────────────────
test('PARITY — web vs electron identical checkout', async ({ page }) => {
  // Web
  await page.goto('http://localhost:4200', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await seedAndReload(page);
  await goToPOS(page);
  const web = await runCheckout(page, 'PARITY-WEB');

  // Electron
  const app = await electron.launch({
    args: [path.join(__dirname, '../../electron/main.js')],
    cwd: path.join(__dirname, '../../electron'),
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 60000,
  });
  const ePage = await getMainWindow(app);
  await ePage.waitForLoadState('domcontentloaded');
  await seedAndReload(ePage);
  await goToPOS(ePage);
  const ele = await runCheckout(ePage, 'PARITY-ELECTRON');

  console.log('\n════════════════ PARITY REPORT ════════════════');
  console.log(`Modal appeared  WEB: ${web.modalAppeared}   ELECTRON: ${ele.modalAppeared}`);
  console.log(`Cash worked     WEB: ${web.cashWorked}   ELECTRON: ${ele.cashWorked}`);
  console.log(`Receipt shown   WEB: ${web.receiptShown}   ELECTRON: ${ele.receiptShown}`);
  console.log(`Payment method  WEB: "${web.receiptPayment}"   ELECTRON: "${ele.receiptPayment}"`);
  console.log(`Total           WEB: "${web.receiptTotal}"   ELECTRON: "${ele.receiptTotal}"`);
  console.log('════════════════════════════════════════════════\n');

  expect(ele.modalAppeared, 'modal parity').toBe(web.modalAppeared);
  expect(ele.cashWorked,    'cash parity').toBe(web.cashWorked);
  expect(ele.receiptShown,  'receipt parity').toBe(web.receiptShown);
  expect(ele.receiptPayment,'payment method parity').toBe(web.receiptPayment);

  await closeElectron(app);
});
