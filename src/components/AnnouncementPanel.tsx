import { useState } from 'react';
import { ANNOUNCEMENT_MAX, fetchEventAnnouncements, sendEventAnnouncement, type AnnouncementAudience } from '../data/notifications';
import { friendlyError } from '../lib/friendlyError';
import { timeAgo } from '../lib/notificationView';
import { useAsync } from '../lib/useAsync';

const EXAMPLES = ['Lyst 2 is running 20 minutes behind.', 'Lunch break ends at 1:15 PM.', 'All fighters report for armour check.'];

/**
 * Event day: a short message from the organizers to the people taking part in THIS event (the bell, and their phones when alerts are on).
 * Not a mailing tool: 140 characters, no links, a few per hour, every one recorded. The database decides who receives it and checks the
 * sender is an organizer of this event again.
 */
export function AnnouncementPanel({ eventId, published }: { eventId: string; published: boolean }) {
  const [key, setKey] = useState(0);
  const history = useAsync(() => fetchEventAnnouncements(eventId), [eventId], [key]);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<AnnouncementAudience>('everyone');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const left = ANNOUNCEMENT_MAX - text.trim().length;
  // The secretary may SEND but is not shown the history (the database refuses it, 42501): that is not an error, the panel is simply send-only.
  const historyRefused = (history.error as { code?: string } | null)?.code === '42501';

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const m = text.trim();
    if (m.length < 3) { setMsg({ ok: false, text: 'Write at least a few words.' }); return; }
    if (m.length > ANNOUNCEMENT_MAX) { setMsg({ ok: false, text: `Keep it to ${ANNOUNCEMENT_MAX} characters.` }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await sendEventAnnouncement(eventId, m, audience);
      setText('');
      setMsg({ ok: true, text: r.recipients === 1 ? 'Sent to 1 person.' : `Sent to ${r.recipients} people.` });
      setKey(k => k + 1);
    } catch (err) { setMsg({ ok: false, text: friendlyError(err, 'Could not send the announcement.') }); } finally { setBusy(false); }
  };

  return (
    <section className="panel info" aria-labelledby="ann-h" style={{ display: 'grid', gap: 12 }}>
      <h2 id="ann-h" className="ed-h">Announce to the event</h2>
      {!published ? <p className="muted" style={{ margin: 0 }}>Publish the event to send announcements.</p> : (
        <form className="ann-form" onSubmit={send} noValidate style={{ display: 'grid', gap: 10 }}>
          <label className="field-in">Message (shows in BuhurtOS, and on phones with alerts on)
            <textarea rows={3} maxLength={ANNOUNCEMENT_MAX + 20} value={text} placeholder={EXAMPLES[0]} onChange={e => { setText(e.target.value); setMsg(null); }} aria-describedby="ann-left" />
          </label>
          <span id="ann-left" className="src" style={{ color: left < 0 ? 'var(--live)' : undefined }}>{left >= 0 ? `${left} characters left` : `${-left} characters too many`} · no links</span>
          <label className="field-in">Who gets it
            <select value={audience} onChange={e => setAudience(e.target.value as AnnouncementAudience)}>
              <option value="everyone">Everyone taking part (fighters, volunteers, staff)</option>
              <option value="fighters">Fighters only</option>
            </select>
          </label>
          <button type="submit" className="btn btn-ink" disabled={busy || text.trim().length < 3 || left < 0}>{busy ? 'Sending…' : 'Send announcement'}</button>
          {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, color: msg.ok ? 'var(--win)' : 'var(--live)' }}>{msg.text}</p>}
        </form>
      )}
      {history.data && history.data.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <b>Sent</b>
          <ul className="ann-list">
            {history.data.slice(0, 5).map(a => (
              <li key={a.id}><span>{a.message}</span><span className="src" style={{ display: 'block' }}>{a.audience === 'fighters' ? 'Fighters' : 'Everyone'} · {a.recipients} {a.recipients === 1 ? 'person' : 'people'} · {timeAgo(a.sentAt)} · {a.sentByName}</span></li>
            ))}
          </ul>
        </div>
      )}
      {history.error != null && !historyRefused && <p role="alert" className="src" style={{ margin: 0 }}>{friendlyError(history.error, 'Could not load sent announcements.')}</p>}
    </section>
  );
}
