import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: mode === 'github-pages' ? '/BuhurtOS/' : '/',
  plugins: [react()],
  build: { sourcemap: true },
  server: { host: true }
}));
