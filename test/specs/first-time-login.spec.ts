/**
 * First-time login flow — Electron
 *
 * Simulates a brand-new device with no stored auth or terminal registration.
 * Flow:
 *   1. App loads → login page — staff selection grid
 *   2. Click "Admin" staff card → PIN numpad (6-digit)
 *   3. Enter admin PIN (123456) → auto-submits → mode-guard sees no terminal → /terminal-setup
 *   4. Fill outlet + terminal fields; enter admin PIN on numpad → Register Terminal
 *   5. Should land on /dashboard
 *
 * Negative test:
 *   - Wrong admin PIN on terminal-setup shows error, stays on setup page
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import type { Page, ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOTS = path.join(__dirname, '../screenshots');
const ADMIN_PIN   = '123456';
const BAD_PIN     = '000000';

// ── Helpers ───────────────────────────────────────────────────────────────

async function closeElectron(app: ElectronApplication) {
  await Promise.race([
    app.close(),
    new Promise<void>(resolve => setTimeout(resolve, 5000)),
  ]);
  try { app.process().kill(); } catch (_) {}
}

async function getMainWindow(app: ElectronApplication): Promise<Page> {
  const waitForMain = async (): Promise<Page> => {
    for (const w of app.windows()) {
      const url = w.url();
      if (!url.startsWith('devtools://') && url !== 'about:blank') return w;
    }
    await new Promise(r => setTimeout(r, 500));
    return waitForMain();
  };
  return waitForMain();
}

/** Poll the local backend /health until it responds (Electron spawns Python first) */
async function waitForBackend(maxMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch('http://localhost:8000/health');
      if (res.ok) return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Backend did not start within ' + maxMs + 'ms');
}

/** Wipe all terminal / auth localStorage keys — simulates a fresh device */
async function clearAppStorage(page: Page) {
  await page.evaluate(() => {
    [
      'pos_auth', 'pos_mode',
      'terminal_uuid', 'terminal_code', 'terminal_name',
      'outlet_uuid', 'outlet_code', 'outlet_name',
      'sync_cache',
    ].forEach(k => localStorage.removeItem(k));
    // Point at local backend so tests never hit Railway
    localStorage.setItem('api_url', 'http://localhost:8000/api');
  });
}

/** Enter PIN digits one by one via the numpad buttons */
async function enterPinOnNumpad(page: Page, pin: string) {
  for (const digit of pin) {
    const btn = digit === '0'
      ? page.locator('.numpad .num-btn:not(.empty):not(.del-btn)', { hasText: '0' })
      : page.locator(`.numpad .num-btn`, { hasText: digit }).first();
    await btn.click();
    await page.waitForTimeout(80); // small delay so dots animate
  }
}

/** Remove the test terminal — login as admin first to get a token */
async function deleteTestTerminal() {
  try {
    const loginRes = await fetch('http://localhost:8000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-POS-Mode': 'restaurant' },
      body: JSON.stringify({ username: 'admin', pin: '123456' }),
    });
    if (!loginRes.ok) return;
    const { token } = await loginRes.json();
    await fetch('http://localhost:8000/api/terminals/info', {
      method: 'DELETE',
      headers: { 'X-POS-Mode': 'restaurant', 'Authorization': `Bearer ${token}` },
    }).catch(() => {});
  } catch (_) { /* best-effort */ }
}

/** Navigate to login page on a running Electron window */
async function resetToLogin(page: Page) {
  // Wait for Angular to bootstrap
  await page.waitForFunction(
    () => {
      const root = document.querySelector('app-root');
      return !!root && root.innerHTML.trim().length > 50;
    },
    { timeout: 60000 }
  );
  // Brief wait for any in-flight verifyWithCloud to complete
  await page.waitForTimeout(2000);
  await clearAppStorage(page);
  await page.evaluate(() => { window.location.hash = '/login'; });
  // Wait for staff selection grid
  await page.waitForSelector('.staff-grid, .no-staff', { timeout: 20000 });
}

// ── Positive: full first-time flow ────────────────────────────────────────
test('ELECTRON — first-time login and terminal registration', async () => {
  const OUTLET_CODE    = 'COL-01';
  const OUTLET_NAME    = 'Colombo Branch';
  const TERMINAL_CODE  = 'TEST-W-01';
  const TERMINAL_NAME  = 'Test Windows 01';

  await deleteTestTerminal();
  fs.mkdirSync(SCREENSHOTS, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '../../electron/main.js')],
    cwd:  path.join(__dirname, '../../electron'),
    env:  { ...process.env, NODE_ENV: 'test' },
    timeout: 60000,
  });

  const page = await getMainWindow(app);
  await page.waitForLoadState('domcontentloaded');

  // Capture browser console output for debugging
  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`[browser-error] ${msg.text()}`);
    else if (msg.text().startsWith('[setup]')) console.log(`[browser] ${msg.text()}`);
  });

  // ── 1. Reset to login ──────────────────────────────────────────────────
  console.log('\n[1] Resetting to login page...');
  await resetToLogin(page);
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-1-staff-grid.png` });

  // Staff grid must be visible
  await expect(page.locator('.login-card')).toBeVisible();
  await expect(page.locator('.staff-grid')).toBeVisible();

  // ── 2. Select Admin staff ──────────────────────────────────────────────
  console.log('[2] Selecting Admin staff card...');
  const adminCard = page.locator('.staff-card', { hasText: 'Admin' }).first();
  await expect(adminCard).toBeVisible({ timeout: 10000 });
  await adminCard.click();

  // PIN numpad phase
  await page.waitForSelector('.pin-screen', { timeout: 10000 });
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-2-pin-numpad.png` });

  await expect(page.locator('.pin-title')).toContainText('6-digit PIN');
  console.log('[2] PIN numpad visible, entering PIN...');

  // ── 3. Enter admin PIN ─────────────────────────────────────────────────
  await enterPinOnNumpad(page, ADMIN_PIN);
  // Auto-submits on 6th digit — wait for navigation away from login
  await page.waitForFunction(
    () => !window.location.hash.includes('/login'),
    { timeout: 15000 }
  );
  console.log(`[3] Navigated to: ${await page.evaluate(() => window.location.hash)}`);

  // ── 4. Terminal setup page ─────────────────────────────────────────────
  await page.waitForSelector('.setup-page', { timeout: 15000 });
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-3-terminal-setup.png` });

  console.log('[4] Terminal setup visible');
  await expect(page.locator('.setup-heading h1')).toContainText('Terminal Setup');

  // UUID must be auto-populated
  const uuid = (await page.locator('.uuid-value').textContent() ?? '').trim();
  expect(uuid, 'Device UUID must be populated').not.toBe('');

  // ── 5. Fill outlet + terminal fields ──────────────────────────────────
  console.log('[5] Filling setup form...');
  await page.locator('input[name="outletCode"]').fill(OUTLET_CODE);
  await page.locator('input[name="outletName"]').fill(OUTLET_NAME);
  await page.locator('input[name="terminalCode"]').fill(TERMINAL_CODE);
  await page.locator('input[name="terminalName"]').fill(TERMINAL_NAME);
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-4-form-filled.png` });

  // ── 6. Enter admin PIN on terminal-setup numpad ────────────────────────
  console.log('[6] Entering admin PIN on setup numpad...');
  await enterPinOnNumpad(page, ADMIN_PIN);
  // Auto-submits on 6th digit — wait a moment for the HTTP calls to complete
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-5-after-pin.png` });

  // Capture any error shown on setup page
  const setupError = await page.locator('.error-msg').textContent({ timeout: 500 }).catch(() => '');
  if (setupError) console.error(`[6] Registration error: "${setupError}"`);
  const hashAfterPin = await page.evaluate(() => window.location.hash);
  console.log(`[6] Hash after PIN: ${hashAfterPin}`);

  // ── 7. Expect dashboard ────────────────────────────────────────────────
  console.log('[7] Waiting for dashboard...');
  await page.waitForFunction(
    () => window.location.hash.includes('/dashboard'),
    { timeout: 30000 }
  );
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-6-dashboard.png` });
  console.log('[7] Dashboard reached!');

  // Verify localStorage was populated
  const storedCode    = await page.evaluate(() => localStorage.getItem('terminal_code'));
  const storedOutlet  = await page.evaluate(() => localStorage.getItem('outlet_code'));
  expect(storedCode?.toUpperCase()).toBe(TERMINAL_CODE.toUpperCase());
  expect(storedOutlet?.toUpperCase()).toBe(OUTLET_CODE.toUpperCase());

  await closeElectron(app);
  await deleteTestTerminal();
});

// ── Negative: wrong admin PIN on terminal-setup ───────────────────────────
test('ELECTRON — terminal-setup rejects wrong admin PIN', async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '../../electron/main.js')],
    cwd:  path.join(__dirname, '../../electron'),
    env:  { ...process.env, NODE_ENV: 'test' },
    timeout: 60000,
  });

  const page = await getMainWindow(app);
  await page.waitForLoadState('domcontentloaded');

  await resetToLogin(page);

  // Select Admin → enter correct PIN to get past login
  const adminCard = page.locator('.staff-card', { hasText: 'Admin' }).first();
  await adminCard.click();
  await page.waitForSelector('.pin-screen', { timeout: 10000 });
  await enterPinOnNumpad(page, ADMIN_PIN);
  await page.waitForSelector('.setup-page', { timeout: 15000 });

  // Fill form fields
  await page.locator('input[name="outletCode"]').fill('ERR-01');
  await page.locator('input[name="outletName"]').fill('Error Outlet');
  await page.locator('input[name="terminalCode"]').fill('TEST-ERR-01');
  await page.locator('input[name="terminalName"]').fill('Error Test Terminal');

  // Enter WRONG admin PIN on numpad
  console.log('[neg] Entering wrong PIN...');
  await enterPinOnNumpad(page, BAD_PIN);
  await page.waitForTimeout(3000); // allow HTTP round-trip + change detection

  const hashNeg = await page.evaluate(() => window.location.hash);
  console.log(`[neg] Hash after bad PIN: ${hashNeg}`);

  // Should show error, stay on setup page
  await page.waitForSelector('.error-msg', { timeout: 10000 });
  const errorMsg = (await page.locator('.error-msg').textContent()) ?? '';
  console.log(`[neg] Error: "${errorMsg}"`);
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-NEG-wrong-pin.png` });

  expect(errorMsg).toContain('Invalid admin PIN');
  await expect(page.locator('.setup-page')).toBeVisible();

  await closeElectron(app);
});
