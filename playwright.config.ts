import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  timeout: 20_000,
  globalTimeout: 180_000,
  retries: 0,
  maxFailures: 3,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4174/BuhurtOS/', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ],
  webServer: {
    command: 'npm run preview -- --mode github-pages --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/BuhurtOS/',
    reuseExistingServer: false,
    timeout: 20_000
  }
});
