import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyNotifications, markNotificationsRead, notificationText } from '../data/teamManager';
import { fetchNotificationFeed } from '../data/notifications';
import { PUSH_EVENT } from './PushWiring';
import { badgeText, bellLabel, notificationLink, timeAgo, unreadCount, unreadIds } from '../lib/notificationView';

const POLL_MS = 60_000;

/** What the bell lists: words and destination come ready-made from the database (the same text a push carries). */
interface BellItem { id: string; unread: boolean; createdAt: string; title: string | null; text: string; to: string }

/** The newer database function gives the words and the tap destination; an older database falls back to the app's own wording. */
async function loadBell(): Promise<BellItem[]> {
  try {
    return (await fetchNotificationFeed(30)).map(n => ({ id: n.id, unread: n.unread, createdAt: n.createdAt, title: n.title, text: n.body, to: n.route }));
  } catch (e) {
    if ((e as { code?: string })?.code !== 'PGRST202') throw e;
    return (await fetchMyNotifications(30)).map(n => ({ id: n.id, unread: n.unread, createdAt: n.createdAt, title: null, text: notificationText(n), to: notificationLink(n) }));
  }
}

/** Header bell for signed-in people. Polls every minute, when the tab regains focus and the moment a push arrives; no realtime. */
export function NotificationBell() {
  const [items, setItems] = useState<BellItem[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [top, setTop] = useState(64);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try { setItems(await loadBell()); setFailed(false); } catch { setFailed(true); }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    window.addEventListener(PUSH_EVENT, onFocus);
    window.addEventListener('online', onFocus);   // back from a dead zone: read what was missed straight away
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.clearInterval(t); window.removeEventListener('focus', onFocus); window.removeEventListener(PUSH_EVENT, onFocus); window.removeEventListener('online', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const count = unreadCount(items);
  const markRead = async (ids?: string[]) => {
    setItems(list => list.map(n => (!ids || ids.includes(n.id) ? { ...n, unread: false } : n)));
    try { await markNotificationsRead(ids); } catch { void load(); }
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button ref={btn} className="icon-btn" type="button" aria-label={bellLabel(count)} aria-expanded={open} aria-controls="notif-panel" onClick={() => { if (!open) { setTop(Math.round((btn.current?.getBoundingClientRect().bottom ?? 56) + 8)); void load(); } setOpen(o => !o); }} style={{ position: 'relative' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {count > 0 && <span aria-hidden="true" style={{ position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: 'var(--live)', color: '#fff', font: '700 11px/18px var(--f-body)', textAlign: 'center' }}>{badgeText(count)}</span>}
      </button>
      {open && (
        <div id="notif-panel" role="region" aria-label="Notifications" className="panel notif-panel" style={{ top }}>
          <div className="notif-head">
            <b>Notifications</b>
            {count > 0 && <button type="button" className="linklike" onClick={() => void markRead(unreadIds(items))}>Mark all read</button>}
          </div>
          {failed && <p role="alert" className="src">Could not refresh. Showing the last list.</p>}
          {items.length === 0 && !failed && <p className="muted" style={{ padding: '4px 14px 12px' }}>Nothing yet. Your fight alerts, team news and registration decisions show up here.</p>}
          <ul className="notif-list">
            {items.map(n => (
              <li key={n.id}>
                <Link className={`notif-item${n.unread ? ' unread' : ''}`} to={n.to} onClick={() => { setOpen(false); if (n.unread) void markRead([n.id]); }}>
                  {n.title && <b className="notif-title">{n.title}</b>}
                  <span className="notif-text">{n.text}</span>
                  <span className="notif-time">{timeAgo(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
