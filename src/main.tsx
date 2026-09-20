import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppStateProvider } from './features/AppState';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><AppStateProvider><App/></AppStateProvider></StrictMode>);
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(()=>undefined));
