/**
 * Sync screen — full end-to-end test
 *
 * Flow:
 *  1. Launch Electron (starts local backend)
 *  2. Seed session (skip login/terminal-setup)
 *  3. Create a pending order via local API
 *  4. Navigate to /sync
 *  5. Verify pending count > 0
 *  6. Click "Sync Transactions"
 *  7. Verify success message, pending count drops, timestamp updates
 *  8. Verify order appears in cloud DB
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import type { Page, ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOTS  = path.join(__dirname, '../screenshots');
const LOCAL_API    = 'http://localhost:8000/api';
const CLOUD_API    = 'https://destinityinspire-pos.up.railway.app/api';

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

/** Wait for local backend to be ready (up to 30s) */
async function waitForBackend(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${LOCAL_API.replace('/api', '')}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Local backend did not start in time');
}

/** Seed localStorage so we skip login + terminal setup */
async function seedSession(page: Page) {
  const res = await fetch(`${LOCAL_API}/terminals/`).catch(() => null);
  const terminals: any[] = res?.ok ? await res.json() : [];
  const terminal = terminals[0];

  await page.evaluate(({ t, api, cloud }) => {
    localStorage.setItem('pos_auth',       'true');
    localStorage.setItem('api_url',        api);
    localStorage.setItem('cloud_api_url',  cloud);
    if (t) {
      localStorage.setItem('terminal_id',   String(t.id));
      localStorage.setItem('terminal_code', t.terminal_code);
      localStorage.setItem('terminal_uuid', t.uuid);
      localStorage.setItem('terminal_name', t.terminal_name);
    }
  }, { t: terminal, api: LOCAL_API, cloud: CLOUD_API });
}

/** Create a pending order via the local API */
async function createPendingOrder(terminalId: number): Promise<any> {
  const res = await fetch(`${LOCAL_API}/orders/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      terminal_id:    terminalId,
      currency:       'LKR',
      total_amount:   750,
      payment_method: 'cash',
      status:         'completed',
      items: [{ product_id: 1, product_name: 'Test Item', quantity: 1, unit_price: 750, subtotal: 750 }],
    }),
  });
  return res.json();
}

/** Get pending orders from local backend */
async function getPendingOrders(): Promise<any[]> {
  const res = await fetch(`${LOCAL_API}/orders/?skip=0&limit=500`);
  const orders: any[] = await res.json();
  return orders.filter((o: any) => o.sync_status === 'pending' || o.sync_status === 'failed');
}

/** Get order count in cloud */
async function getCloudOrderCount(): Promise<number> {
  try {
    const res = await fetch(`${CLOUD_API}/reports/orders`);
    const data = await res.json();
    return data.total || 0;
  } catch { return 0; }
}

// ── Test ──────────────────────────────────────────────────────────────────────
test('ELECTRON — full sync flow: create order locally → sync to cloud', async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });

  // ── 1. Launch Electron ──────────────────────────────────────────────────────
  const app = await electron.launch({
    args: [path.join(__dirname, '../../electron/main.js')],
    cwd: path.join(__dirname, '../../electron'),
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 60000,
  });

  const page = await getMainWindow(app);
  await page.waitForLoadState('domcontentloaded');

  // Wait for Angular to boot
  await page.waitForFunction(
    () => !!document.querySelector('app-root') && document.querySelector('app-root')!.innerHTML.trim().length > 50,
    { timeout: 30000 }
  );

  // Wait for local backend to be ready
  await waitForBackend();
  console.log('\n[sync] Local backend ready');

  // ── 2. Seed session ─────────────────────────────────────────────────────────
  await seedSession(page);

  // ── 3. Create a pending order via local API ─────────────────────────────────
  const terminals = await fetch(`${LOCAL_API}/terminals/`).then(r => r.json());
  const terminal  = terminals[0];
  console.log(`[sync] Using terminal: ${terminal?.terminal_code} (id=${terminal?.id})`);

  const cloudCountBefore = await getCloudOrderCount();
  console.log(`[sync] Cloud order count before: ${cloudCountBefore}`);

  const newOrder = await createPendingOrder(terminal.id);
  console.log(`[sync] Created order #${newOrder.id} ref=${newOrder.terminal_order_ref} status=${newOrder.sync_status}`);

  const pendingBefore = await getPendingOrders();
  console.log(`[sync] Pending orders before sync: ${pendingBefore.length}`);

  // ── 4. Navigate to sync page ────────────────────────────────────────────────
  await page.evaluate(() => { window.location.hash = '/sync'; });

  const syncLoaded = await page.waitForSelector('.sync-page', { timeout: 20000 })
    .then(() => true).catch(() => false);

  if (!syncLoaded) {
    await page.screenshot({ path: `${SCREENSHOTS}/SYNC-0-failed.png` });
    throw new Error(`Sync page did not load. Hash: ${await page.evaluate(() => window.location.hash)}`);
  }

  await page.screenshot({ path: `${SCREENSHOTS}/SYNC-1-loaded.png` });
  console.log('[sync] Sync page loaded');

  // ── 5. Verify pending count in UI ──────────────────────────────────────────
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.status-card .status-time');
      return !!el && /\d/.test(el.textContent || '');
    },
    { timeout: 8000 }
  ).catch(() => {});

  const pendingCardText = await page.locator('.status-card:has-text("Pending Orders") .status-time')
    .textContent({ timeout: 3000 }).catch(() => '');
  console.log(`[sync] UI shows pending: "${pendingCardText?.trim()}"`);

  // ── 6. Click Sync Transactions ──────────────────────────────────────────────
  const syncTxBtn = page.locator('.sync-btn.transactions');
  await page.screenshot({ path: `${SCREENSHOTS}/SYNC-2-before-click.png` });

  await syncTxBtn.click({ force: true });
  console.log('[sync] Clicked Sync Transactions');

  // Wait for result (up to 30s — cloud roundtrip)
  await Promise.race([
    page.waitForSelector('.result-msg', { timeout: 30000 }).catch(() => {}),
    (async () => {
      for (let i = 0; i < 60; i++) {
        const btn = await syncTxBtn.textContent({ timeout: 500 }).catch(() => '');
        if (!btn?.includes('Syncing')) return;
        await new Promise(r => setTimeout(r, 500));
      }
    })(),
  ]);

  await page.screenshot({ path: `${SCREENSHOTS}/SYNC-3-after-sync.png` });

  const successMsg = await page.locator('.result-msg.success').textContent({ timeout: 1000 }).catch(() => '');
  const errorMsg   = await page.locator('.result-msg.error').textContent({ timeout: 1000 }).catch(() => '');
  console.log(`[sync] Success: "${successMsg?.trim()}"`);
  console.log(`[sync] Error:   "${errorMsg?.trim()}"`);

  // ── 7. Verify pending count dropped ────────────────────────────────────────
  await page.waitForTimeout(2000);
  const pendingAfterText = await page.locator('.status-card:has-text("Pending Orders") .status-time')
    .textContent({ timeout: 5000 }).catch(() => '');
  const lastSyncText = await page.locator('.status-card:has-text("Last Transaction Sync") .status-time')
    .textContent({ timeout: 3000 }).catch(() => '');

  const pendingAfter = await getPendingOrders();
  console.log(`[sync] Pending after sync: ${pendingAfter.length}`);
  console.log(`[sync] UI pending: "${pendingAfterText?.trim()}"`);
  console.log(`[sync] Last sync timestamp: "${lastSyncText?.trim()}"`);

  // ── 8. Verify order appears in cloud ───────────────────────────────────────
  const cloudCountAfter = await getCloudOrderCount();
  console.log(`[sync] Cloud order count after: ${cloudCountAfter}`);

  // ── Assertions ────────────────────────────────────────────────────────────
  expect(pendingBefore.length, 'Should have pending orders before sync').toBeGreaterThan(0);

  if (errorMsg?.trim()) throw new Error(`Sync failed: ${errorMsg.trim()}`);

  expect(successMsg?.trim(), 'Should show success message').toBeTruthy();
  expect(pendingAfter.length, 'Pending count should drop after sync').toBeLessThan(pendingBefore.length);
  expect(lastSyncText?.trim(), 'Last Transaction Sync timestamp should update').not.toBe('Never');
  expect(cloudCountAfter, 'Cloud should have more orders after sync').toBeGreaterThan(cloudCountBefore);

  await closeElectron(app);
});
