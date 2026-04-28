import { test } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import * as path from 'path';

test('camera debug', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '../../electron/main.js')],
    cwd: path.join(__dirname, '../../electron'),
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 60000,
  });

  const page = await app.firstWindow();
  page.on('console', msg => console.log('[CONSOLE]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(10000);

  const info = await page.evaluate(async () => {
    const result: any = {
      isSecureContext: window.isSecureContext,
      protocol: window.location.protocol,
      href: window.location.href,
      hasMediaDevices: !!navigator.mediaDevices,
      hasGetUserMedia: !!(navigator.mediaDevices?.getUserMedia),
    };

    if (navigator.mediaDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        result.cameras = devices.filter((d: any) => d.kind === 'videoinput')
          .map((d: any) => ({ id: d.deviceId, label: d.label }));
      } catch(e: any) { result.enumerateError = e.message; }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((t: any) => t.stop());
        result.getUserMedia = 'SUCCESS';
      } catch(e: any) { result.getUserMedia = e.name + ': ' + e.message; }
    }
    return result;
  });

  console.log('\n=== CAMERA DEBUG ===\n' + JSON.stringify(info, null, 2));
  await app.close();
});
