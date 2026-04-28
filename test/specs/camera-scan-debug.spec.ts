import { test } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import * as path from 'path';

test('camera scan debug', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '../../electron/main.js')],
    cwd: path.join(__dirname, '../../electron'),
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 60000,
  });

  const page = await app.firstWindow();

  const consoleLogs: string[] = [];
  page.on('console', msg => {
    const t = msg.text();
    consoleLogs.push(`[${msg.type()}] ${t}`);
    if (msg.type() === 'error' || t.toLowerCase().includes('camera') || t.toLowerCase().includes('error') || t.toLowerCase().includes('scan')) {
      console.log(`[CONSOLE ${msg.type()}]`, t);
    }
  });
  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(8000);

  // Navigate to products
  await page.evaluate(() => { (window as any).location.hash = '/products'; });
  await page.waitForTimeout(2000);

  // Click scan button
  const scanBtn = page.locator('.scan-fill-btn').first();
  const hasScanBtn = await scanBtn.isVisible().catch(() => false);
  console.log('Scan button visible:', hasScanBtn);

  if (hasScanBtn) {
    await scanBtn.click();
    console.log('Clicked scan button');
    await page.waitForTimeout(3000);

    // Check overlay
    const overlay = await page.locator('#scanner-overlay').isVisible().catch(() => false);
    console.log('Overlay visible:', overlay);

    // Check for errors in console
    const errors = consoleLogs.filter(l => l.includes('error') || l.includes('Error'));
    console.log('\nAll errors/warnings:');
    errors.forEach(e => console.log(' ', e));

    // Check scanner state via JS
    const scannerInfo = await page.evaluate(() => {
      const container = document.getElementById('qr-scanner-container');
      return {
        containerHTML: container?.innerHTML?.substring(0, 500) || 'not found',
        hasVideo: !!container?.querySelector('video'),
        videoSrc: container?.querySelector('video')?.srcObject ? 'has stream' : 'no stream',
      };
    });
    console.log('\nScanner container:', JSON.stringify(scannerInfo, null, 2));
  }

  await app.close();
});
