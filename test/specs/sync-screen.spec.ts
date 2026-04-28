/**
 * Sync screen — transaction sync test
 *
 * Pre-conditions:
 *  - Backend running on localhost:8000
 *  - At least one order with sync_status='pending' and hq_order_id=null in local SQLite
 *
 * Flow:
 *  1. Login → terminal-setup (if needed) → navigate to /sync
 *  2. Verify pending order count > 0
 *  3. Click "Sync Transactions"
 *  4. Verify result message and pending count decreases (or error is clearly shown)
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import type { Page, ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOTS = path.join(__dirname, '../screenshots');

async function closeElectron(app: ElectronApplication) {
  await Promise.race([app.close(), new Promise<void>(r => setTimeout(r, 5000))]);
  try { app.process().kill(); } catch (_) {}
}

async function getMainWindow(app: ElectronApplication): Promise<Page> {
  const wait = async (): Promise<Page> => {
    for (const w of app.windows()) {
      const url = w.url();
      if (!url.startsWith('devtools://') && url !== 'about:blank') return w;
    }
    await new Promise(r => setTimeout(r, 500));
    return wait();
  };
  return wait();
}

/** Wait for Angular to boot then navigate directly to a route */
async function goTo(page: Page, hash: string) {
  await page.waitForFunction(
    () => !!document.querySelector('app-root') && document.querySelector('app-root')!.innerHTML.trim().length > 50,
    { timeout: 30000 }
  );
  await page.evaluate((h) => { window.location.hash = h; }, hash);
}

/** Seed localStorage so we skip login + terminal setup */
async function seedSession(page: Page) {
  // Get terminal from DB to seed terminal_id
  const res = await fetch('http://localhost:8000/api/terminals/').catch(() => null);
  const terminals: any[] = res?.ok ? await res.json() : [];
  const terminal = terminals[0];

  await page.evaluate(({ t }) => {
    localStorage.setItem('pos_auth',       'true');
    localStorage.setItem('api_url',        'http://localhost:8000/api');
    if (t) {
      localStorage.setItem('terminal_id',   String(t.id));
      localStorage.setItem('terminal_code', t.terminal_code);
      localStorage.setItem('terminal_uuid', t.uuid);
      localStorage.setItem('terminal_name', t.terminal_name);
    }
  }, { t: terminal });
}

// ── Helpers to inspect backend state ──────────────────────────────────────────
async function getPendingOrders() {
  const res = await fetch('http://localhost:8000/api/orders/?skip=0&limit=500');
  const orders: any[] = await res.json();
  return orders.filter((o: any) => o.sync_status === 'pending' || o.sync_status === 'failed');
}

// ── Test ──────────────────────────────────────────────────────────────────────
test('ELECTRON — sync page shows pending orders and transaction sync', async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });

  // ── Pre-check: ensure there are pending orders ──────────────────────────────
  const pendingBefore = await getPendingOrders();
  console.log(`\n[sync] Pending orders in SQLite before test: ${pendingBefore.length}`);
  console.log('[sync] Orders:', pendingBefore.map((o: any) => `#${o.id} sync_status=${o.sync_status} hq_order_id=${o.hq_order_id}`).join(', '));

  const app = await electron.launch({
    args: [path.join(__dirname, '../../electron/main.js')],
    cwd: path.join(__dirname, '../../electron'),
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 60000,
  });

  const page = await getMainWindow(app);
  await page.waitForLoadState('domcontentloaded');

  // Wait for Angular to fully boot before seeding
  await page.waitForFunction(
    () => !!document.querySelector('app-root') && document.querySelector('app-root')!.innerHTML.trim().length > 50,
    { timeout: 30000 }
  );

  // Seed session (skip login & terminal-setup)
  await seedSession(page);

  // Navigate to sync page
  await page.evaluate(() => { window.location.hash = '/sync'; });

  // Wait for sync page — if modeGuard fails it goes elsewhere, so check hash too
  const syncLoaded = await page.waitForSelector('.sync-page', { timeout: 20000 })
    .then(() => true).catch(() => false);

  const currentHash = await page.evaluate(() => window.location.hash);
  console.log(`[sync] Hash after navigate: "${currentHash}", sync-page loaded: ${syncLoaded}`);

  if (!syncLoaded) {
    await page.screenshot({ path: `${SCREENSHOTS}/SYNC-0-failed-to-load.png` });
    throw new Error(`Sync page did not load. Current hash: ${currentHash}`);
  }

  await page.screenshot({ path: `${SCREENSHOTS}/SYNC-1-loaded.png` });
  console.log('[sync] Sync page loaded');

  // ── Read displayed pending count (wait for loadPendingCount() to complete) ──
  // The count loads async; wait until it shows a non-zero value or 3s pass
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.status-card .status-time');
      // any status-time that contains a digit means data has loaded
      return !!el && /\d/.test(el.textContent || '');
    },
    { timeout: 8000 }
  ).catch(() => {});
  const pendingCardText = await page.locator('.status-card:has-text("Pending Orders") .status-time')
    .textContent({ timeout: 3000 }).catch(() => '');
  console.log(`[sync] UI shows pending: "${pendingCardText?.trim()}"`);

  // ── Click Sync Transactions ─────────────────────────────────────────────────
  const syncTxBtn = page.locator('.sync-btn.transactions');
  const btnEnabled = await syncTxBtn.isEnabled();
  console.log(`[sync] Sync Transactions button enabled: ${btnEnabled}`);

  if (!btnEnabled) {
    const offlineWarn = await page.locator('.offline-warn').textContent({ timeout: 1000 }).catch(() => '');
    console.log(`[sync] Offline warning: "${offlineWarn?.trim()}"`);
  }

  await page.screenshot({ path: `${SCREENSHOTS}/SYNC-2-before-click.png` });

  await syncTxBtn.click({ force: true });
  console.log('[sync] Clicked Sync Transactions');

  // Wait for result (up to 30s — cloud roundtrip)
  const resultAppeared = await Promise.race([
    page.waitForSelector('.result-msg', { timeout: 30000 }).then(() => true).catch(() => false),
    (async () => {
      for (let i = 0; i < 60; i++) {
        const btn = await syncTxBtn.textContent({ timeout: 500 }).catch(() => '');
        if (!btn?.includes('Syncing')) return 'button-idle';
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    })(),
  ]);

  await page.screenshot({ path: `${SCREENSHOTS}/SYNC-3-after-sync.png` });

  const successMsg = await page.locator('.result-msg.success').textContent({ timeout: 1000 }).catch(() => '');
  const errorMsg   = await page.locator('.result-msg.error').textContent({ timeout: 1000 }).catch(() => '');
  console.log(`[sync] Success message: "${successMsg?.trim()}"`);
  console.log(`[sync] Error message:   "${errorMsg?.trim()}"`);

  // ── Re-read pending count after sync (refresh() is called by doTransactionSync) ─
  await page.waitForTimeout(2000);
  const pendingAfterText = await page.locator('.status-card:has-text("Pending Orders") .status-time')
    .textContent({ timeout: 5000 }).catch(() => '');
  console.log(`[sync] UI pending count after sync: "${pendingAfterText?.trim()}"`);

  const pendingAfter = await getPendingOrders();
  console.log(`[sync] Pending orders in SQLite after sync: ${pendingAfter.length}`);

  // ── Check that Last Transaction Sync timestamp updated ─────────────────────
  const lastSyncText = await page.locator('.status-card:has-text("Last Transaction Sync") .status-time')
    .textContent({ timeout: 3000 }).catch(() => '');
  console.log(`[sync] Last Transaction Sync card shows: "${lastSyncText?.trim()}"`);

  // ── Assertions ───────────────────────────────────────────────────────────────
  expect(pendingBefore.length, 'There should be pending orders before sync').toBeGreaterThan(0);

  if (errorMsg?.trim()) {
    // Fail with the actual error so the user can see what went wrong
    throw new Error(`Sync failed: ${errorMsg.trim()}`);
  }

  expect(successMsg?.trim(), 'Sync should report success').toBeTruthy();
  expect(lastSyncText?.trim(), 'Last Transaction Sync should not show Never after a successful sync')
    .not.toBe('Never');

  await closeElectron(app);
});
