import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: mode === 'github-pages' ? '/BuhurtOS/' : '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false
  },
  server: { host: true }
}));
