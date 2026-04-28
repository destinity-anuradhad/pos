/**
 * First-time login flow — Electron
 *
 * Simulates a brand-new device with no stored auth or terminal registration.
 * Flow:
 *   1. App loads → login page (no pos_auth in localStorage)
 *   2. Enter PIN 1234 → auth succeeds → mode-guard detects no terminal → /terminal-setup
 *   3. Fill terminal_code, terminal_name, admin PIN → Register Terminal → /dashboard
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import type { Page, ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOTS = path.join(__dirname, '../screenshots');

async function closeElectron(app: ElectronApplication) {
  await Promise.race([
    app.close(),
    new Promise<void>(resolve => setTimeout(resolve, 5000)),
  ]);
  try { app.process().kill(); } catch (_) {}
}

/** Return the main app window (not DevTools) */
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

/** Wipe all localStorage keys that the app uses — simulates fresh device */
async function clearAppStorage(page: Page) {
  await page.evaluate(() => {
    const keys = [
      'pos_auth', 'pos_mode',
      'terminal_uuid', 'terminal_id', 'terminal_code',
      'api_url', 'sync_cache',
    ];
    keys.forEach(k => localStorage.removeItem(k));
    // Force api_url to local backend so tests don't hit Railway
    localStorage.setItem('api_url', 'http://localhost:8000/api');
  });
}

/**
 * Reset app to login page without calling page.reload() which fails on file:// URLs.
 * Clears storage then navigates directly to /#/login (no guards on this route).
 * Also waits for Angular to have bootstrapped first so the hash change is picked up.
 */
async function resetToLogin(page: Page) {
  // Wait for Angular to boot (any app-root content visible) before clearing storage
  await page.waitForFunction(
    () => !!document.querySelector('app-root') && document.querySelector('app-root')!.innerHTML.trim().length > 50,
    { timeout: 30000 }
  );
  await clearAppStorage(page);
  // Navigate directly to /login — this route has no guards so always shows login page
  await page.evaluate(() => { window.location.hash = '/login'; });
  await page.waitForSelector('.pin-input', { timeout: 20000 });
}

// ── Cleanup: remove the test terminal after test run ──────────────────────
async function deleteTestTerminal(terminalCode: string) {
  try {
    const res = await fetch('http://localhost:8000/api/terminals/');
    if (!res.ok) return;
    const data: { id?: number; terminal_code?: string }[] = await res.json().catch(() => []);
    if (!Array.isArray(data)) return;
    for (const t of data) {
      if (t.terminal_code?.toUpperCase() === terminalCode.toUpperCase() && t.id) {
        await fetch(`http://localhost:8000/api/terminals/${t.id}`, { method: 'DELETE' }).catch(() => {});
        console.log(`[cleanup] Deleted terminal ${t.terminal_code} (id=${t.id})`);
      }
    }
  } catch (_) { /* best-effort */ }
}

// ──────────────────────────────────────────────────────────────────────────
test('ELECTRON — first-time login flow', async () => {
  const TEST_TERMINAL_CODE = 'TEST-W-01';
  const TEST_TERMINAL_NAME = 'Test Windows 01';
  const ADMIN_PIN = '1234';

  // Pre-clean: remove test terminal from previous runs
  await deleteTestTerminal(TEST_TERMINAL_CODE);

  fs.mkdirSync(SCREENSHOTS, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '../../electron/main.js')],
    cwd: path.join(__dirname, '../../electron'),
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 60000,
  });

  const page = await getMainWindow(app);
  await page.waitForLoadState('domcontentloaded');

  // ── STEP 1: Wipe storage so app treats this as a fresh device ──────────
  // resetToLogin clears storage and navigates via hash (safe for file:// URLs)
  console.log('\n[login] Resetting to login page...');
  await resetToLogin(page);
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-1-login.png` });

  // ── STEP 2: Login page must be visible ─────────────────────────────────
  console.log('[login] Login page visible');
  expect(
    await page.locator('.login-card').isVisible(),
    'Login card must be visible on first load'
  ).toBe(true);

  // ── STEP 3: Enter PIN ───────────────────────────────────────────────────
  console.log('[login] Entering PIN...');
  await page.locator('.pin-input').fill(ADMIN_PIN);
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-2-pin-entered.png` });

  await page.locator('.login-btn').click();

  // ── STEP 4: Redirect to terminal-setup (no terminal registered) ─────────
  console.log('[login] Waiting for terminal-setup...');
  await page.waitForSelector('.setup-card', { timeout: 20000 });
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-3-terminal-setup.png` });

  expect(
    await page.locator('h1.setup-title').textContent(),
    'Terminal Setup heading must be visible'
  ).toContain('Terminal Setup');

  // UUID should be auto-populated (non-empty)
  const uuidText = (await page.locator('.uuid-value').textContent() ?? '').trim();
  expect(uuidText, 'Device UUID must be populated').not.toBe('');

  // ── STEP 5: Fill the registration form ─────────────────────────────────
  console.log('[setup] Filling registration form...');
  await page.locator('input[name="terminalCode"]').fill(TEST_TERMINAL_CODE);
  await page.locator('input[name="terminalName"]').fill(TEST_TERMINAL_NAME);
  await page.locator('input[name="adminPin"]').fill(ADMIN_PIN);
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-4-form-filled.png` });

  // ── STEP 6: Submit form ─────────────────────────────────────────────────
  console.log('[setup] Registering terminal...');
  await page.locator('.save-btn').click();

  // ── STEP 7: Should land on dashboard ───────────────────────────────────
  console.log('[setup] Waiting for dashboard...');

  // Dashboard has .stats-grid or .page-title "Dashboard"; also check hash route
  const dashboardReached = await Promise.race([
    page.waitForSelector('.stats-grid, .stat-card', { timeout: 20000 })
      .then(() => true).catch(() => false),
    // Fallback: hash route contains /dashboard
    (async () => {
      for (let i = 0; i < 40; i++) {
        const hash = await page.evaluate(() => window.location.hash);
        if (hash.includes('dashboard')) return true;
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    })(),
  ]);

  await page.screenshot({ path: `${SCREENSHOTS}/FTL-5-dashboard.png` });
  console.log(`[setup] Dashboard reached: ${dashboardReached}`);

  // Verify terminal info is now stored
  const storedCode = await page.evaluate(() => localStorage.getItem('terminal_code'));
  const storedId   = await page.evaluate(() => localStorage.getItem('terminal_id'));
  console.log(`[setup] Stored terminal_code: ${storedCode}, terminal_id: ${storedId}`);

  // ── Assertions ──────────────────────────────────────────────────────────
  expect(dashboardReached, 'Must reach dashboard after registration').toBe(true);
  expect(storedCode?.toUpperCase(), 'terminal_code must be saved in localStorage').toBe(TEST_TERMINAL_CODE.toUpperCase());
  expect(storedId, 'terminal_id must be saved in localStorage').not.toBeNull();

  // ── Cleanup ─────────────────────────────────────────────────────────────
  await closeElectron(app);
  await deleteTestTerminal(TEST_TERMINAL_CODE);
});

// ── Negative: wrong admin PIN ──────────────────────────────────────────────
test('ELECTRON — terminal-setup rejects wrong admin PIN', async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '../../electron/main.js')],
    cwd: path.join(__dirname, '../../electron'),
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 60000,
  });

  const page = await getMainWindow(app);
  await page.waitForLoadState('domcontentloaded');

  await resetToLogin(page);

  // Login
  await page.locator('.pin-input').fill('1234');
  await page.locator('.login-btn').click();

  // Terminal setup
  await page.waitForSelector('.setup-card', { timeout: 20000 });

  // Fill with WRONG admin PIN
  await page.locator('input[name="terminalCode"]').fill('TEST-ERR-01');
  await page.locator('input[name="terminalName"]').fill('Error Test Terminal');
  await page.locator('input[name="adminPin"]').fill('0000');  // wrong PIN
  await page.locator('.save-btn').click();

  // Should show error message, stay on setup page
  const errorMsg = await page.locator('.error-msg').textContent({ timeout: 5000 }).catch(() => '');
  console.log(`[neg-test] Error message: "${errorMsg}"`);
  await page.screenshot({ path: `${SCREENSHOTS}/FTL-NEG-wrong-pin.png` });

  expect(errorMsg, 'Must show invalid PIN error').toContain('Invalid admin PIN');
  expect(
    await page.locator('.setup-card').isVisible(),
    'Must stay on setup page after wrong PIN'
  ).toBe(true);

  await closeElectron(app);
});
