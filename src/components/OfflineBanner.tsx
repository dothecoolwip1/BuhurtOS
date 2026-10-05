import { useEffect, useState } from 'react';

/** Says plainly when there is no signal, so stale screens are never mistaken for live ones. Scoring keeps its own, more specific offline messages. */
export function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (online) return null;
  return <p role="status" className="panel info offline-banner" style={{ margin: '8px 0' }}><b>You are offline.</b> What you see may be out of date, and changes cannot be saved until you have signal again.</p>;
}
