import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swPrecachePlugin } from './scripts/swPrecachePlugin';

// GitHub Pages serves this repo at /BuhurtOS/. Set VITE_BASE=/ for a custom domain.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.VITE_BASE ?? '/BuhurtOS/') : '/',
  plugins: [react(), swPrecachePlugin()],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] }
}));
