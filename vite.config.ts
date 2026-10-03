import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { swPrecachePlugin } from './scripts/swPrecachePlugin';

/** What the footer shows, so you can see which build you are looking at: package version, CI run number, short commit and build date. */
const git = (cmd: string) => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const commit = (process.env.GITHUB_SHA ?? git('git rev-parse HEAD')).slice(0, 7);
const build = process.env.GITHUB_RUN_NUMBER ? `build ${process.env.GITHUB_RUN_NUMBER}` : 'local';
const APP_VERSION = [`v${pkg.version}`, build, commit, new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'].filter(Boolean).join(' · ');

// GitHub Pages serves this repo at /BuhurtOS/. Vercel serves the app from the domain root.
export default defineConfig(({ command }) => ({
  base: command === 'build'
    ? (process.env.VERCEL ? '/' : (process.env.VITE_BASE ?? '/BuhurtOS/'))
    : '/',
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [react(), swPrecachePlugin()],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] }
}));
