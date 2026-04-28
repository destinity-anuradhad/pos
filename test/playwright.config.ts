import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  timeout: 120000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
    screenshot: 'on',
    video: 'off',
  },
});
