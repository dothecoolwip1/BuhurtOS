import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { initAnalytics } from './lib/analytics';
import { registerServiceWorker } from './lib/swUpdate';
import './styles/app.css';

initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AuthProvider><App /></AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

// Offline app shell. Only in production builds, so local development is never served stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => registerServiceWorker(`${import.meta.env.BASE_URL}sw.js`));
}
