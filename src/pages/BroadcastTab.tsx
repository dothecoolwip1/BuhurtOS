import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LiveEvent } from '../data/api';
import { fetchBroadcastConfig, removeSponsor, saveBroadcastSettings, saveSponsor, uploadSponsorLogo, type BroadcastSettings } from '../data/broadcast';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useBroadcast } from '../lib/broadcast/useBroadcast';
import { BACKGROUND_LABEL, LAYOUT_LABEL, OBS_SIZE, overlayUrl, type OverlayBackground, type OverlayLayout } from '../lib/broadcast/obsUrl';
import { parseStream } from '../lib/broadcast/stream';
import type { Sponsor } from '../lib/broadcast/sponsors';

/**
 * Manage > Broadcast (organizers). Everything here is presentation: the address of the livestream, how the overlay looks, the event's sponsors and the
 * addresses OBS opens. Scores, clocks and the fight order are never set here: the overlay reads them from the same state as the venue display.
 * Phone first: one column, 44 px controls.
 */
export function BroadcastTab({ event }: { event: LiveEvent }) {
  const [key, setKey] = useState(0);
  const cfg = useAsync(() => fetchBroadcastConfig(event.id), [event.id], [key]);
  const live = useBroadcast(event.slug, null);
  const fields = live.fields.length > 0 ? live.fields : ['Field 1'];
  const published = event.status === 'published';
  return (
    <div style={{ display: 'grid', gap: 18 }} className="bt">
      <section className="panel info" style={{ display: 'grid', gap: 8 }}>
        <h2 className="ed-h">Livestream and broadcast graphics</h2>
        <p>Put your livestream on the public event page, and give OBS a graphics overlay (scoreboard, fighters, fight order, sponsors) that follows the real fight by itself. Nobody has to run it: scores, clock and order come from the same place as the venue display.</p>
        {!published && <p role="status" className="chip brass" style={{ justifySelf: 'start' }}>This event is not published yet. The overlay and the livestream block only show for published events.</p>}
      </section>
      {cfg.loading && <p role="status">Loading…</p>}
      {cfg.error != null && <p role="alert" style={{ color: 'var(--live)' }}>{friendlyError(cfg.error)}</p>}
      {cfg.data && <>
        <StreamAndLook eventId={event.id} settings={cfg.data.settings} onSaved={() => setKey(k => k + 1)} />
        <ObsLinks slug={event.slug} fields={fields} />
        <Sponsors eventId={event.id} sponsors={cfg.data.sponsors} logoPaths={cfg.data.logoPaths} onChanged={() => setKey(k => k + 1)} />
      </>}
    </div>
  );
}

function StreamAndLook({ eventId, settings, onSaved }: { eventId: string; settings: BroadcastSettings; onSaved: () => void }) {
  const [url, setUrl] = useState(settings.streamUrl ?? '');
  const [title, setTitle] = useState(settings.streamTitle ?? '');
  const [corners, setCorners] = useState(settings.corners);
  const [records, setRecords] = useState(settings.showRecords);
  const [photos, setPhotos] = useState(settings.showPhotos);
  const [sponsors, setSponsors] = useState(settings.showSponsors);
  const [seconds, setSeconds] = useState(String(settings.sponsorSeconds));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const parsed = url.trim() ? parseStream(url, window.location.hostname) : null;
  const bad = url.trim() !== '' && !parsed;
  const secs = Number(seconds);
  const secsOk = Number.isInteger(secs) && secs >= 3 && secs <= 60;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bad || !secsOk) { setMsg({ ok: false, text: bad ? 'That address is not YouTube, Twitch or Vimeo (https).' : 'Sponsor time is 3 to 60 seconds.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await saveBroadcastSettings(eventId, { stream_url: url.trim(), stream_title: title.trim(), corners, show_records: records, show_photos: photos, show_sponsors: sponsors, sponsor_seconds: secs });
      setMsg({ ok: true, text: 'Saved.' }); onSaved();
    } catch (err) { setMsg({ ok: false, text: friendlyError(err) }); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} noValidate className="panel info" style={{ display: 'grid', gap: 14 }} aria-label="Livestream and look">
      <h3>Livestream</h3>
      <label className="field-in">Livestream link (YouTube, Twitch or Vimeo)
        <input type="url" inputMode="url" autoComplete="off" placeholder="https://www.youtube.com/watch?v=…" value={url} maxLength={300} onChange={e => { setUrl(e.target.value); setMsg(null); }} aria-invalid={bad} />
      </label>
      {bad && <p role="alert" style={{ color: 'var(--live)' }}>Use a full https link from YouTube, Twitch or Vimeo.</p>}
      {parsed && !parsed.embedUrl && <p role="status">This link will show as a "Watch the stream" button (it cannot be played inside the page). A normal watch or live link can be.</p>}
      {parsed?.embedUrl && <p role="status">The stream will play on the public event page.</p>}
      <label className="field-in">Title above the stream (optional)<input value={title} maxLength={80} onChange={e => setTitle(e.target.value)} /></label>
      <h3>How the overlay looks</h3>
      <label className="field-in">Fighter corners
        <select value={corners} onChange={e => setCorners(e.target.value as BroadcastSettings['corners'])}>
          <option value="red_blue">Red and blue corners</option>
          <option value="team_colors">Each team's own colours</option>
        </select>
      </label>
      <label className="qs-check"><input type="checkbox" checked={records} onChange={e => setRecords(e.target.checked)} /> Show win-loss records</label>
      <label className="qs-check"><input type="checkbox" checked={photos} onChange={e => setPhotos(e.target.checked)} /> Show fighter photos and team crests</label>
      <label className="qs-check"><input type="checkbox" checked={sponsors} onChange={e => setSponsors(e.target.checked)} /> Show sponsors on the overlay</label>
      <label className="field-in">Seconds each group of sponsors stays up (3 to 60)<input inputMode="numeric" value={seconds} onChange={e => setSeconds(e.target.value.replace(/\D/g, ''))} aria-invalid={!secsOk} /></label>
      <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Saving…' : 'Save broadcast settings'}</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--win)' : 'var(--live)' }}>{msg.text}</p>}
    </form>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-line" aria-label={`Copy ${label}`} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 2000); } catch { setDone(false); }
    }}>{done ? 'Copied' : 'Copy link'}</button>
  );
}

function ObsLinks({ slug, fields }: { slug: string; fields: string[] }) {
  const [field, setField] = useState(fields[0] ?? 'Field 1');
  const [layout, setLayout] = useState<OverlayLayout>('full');
  const [bg, setBg] = useState<OverlayBackground>('transparent');
  useEffect(() => { if (!fields.includes(field)) setField(fields[0] ?? 'Field 1'); }, [fields, field]);
  const url = overlayUrl(window.location.origin, import.meta.env.BASE_URL, slug, field, { layout, bg });
  const preview = overlayUrl(window.location.origin, import.meta.env.BASE_URL, slug, field, { layout, bg: bg === 'transparent' ? 'dark' : bg });
  return (
    <section className="panel info" style={{ display: 'grid', gap: 14 }} aria-label="OBS overlay">
      <h3>OBS overlay</h3>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
        <li>In OBS, add a <b>Browser</b> source.</li>
        <li>Paste the link below. Set the width to <b>{OBS_SIZE.width}</b> and the height to <b>{OBS_SIZE.height}</b>.</li>
        <li>Leave "Shutdown source when not visible" off, and do not sign in: the overlay is public and cannot change anything.</li>
      </ol>
      <label className="field-in">Field
        <select value={field} onChange={e => setField(e.target.value)}>{fields.map(f => <option key={f}>{f}</option>)}</select>
      </label>
      <label className="field-in">What to draw
        <select value={layout} onChange={e => setLayout(e.target.value as OverlayLayout)}>{(Object.keys(LAYOUT_LABEL) as OverlayLayout[]).map(l => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}</select>
      </label>
      <label className="field-in">Background
        <select value={bg} onChange={e => setBg(e.target.value as OverlayBackground)}>{(Object.keys(BACKGROUND_LABEL) as OverlayBackground[]).map(b => <option key={b} value={b}>{BACKGROUND_LABEL[b]}</option>)}</select>
      </label>
      <label className="field-in">Link for OBS<input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="Link for OBS" style={{ fontFamily: 'var(--f-data)', fontSize: 13 }} /></label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <CopyButton text={url} label="OBS link" />
        <a className="btn btn-line" href={preview} target="_blank" rel="noreferrer">Preview in a new tab</a>
        <Link className="btn btn-line" to={`/events/${slug}/arena`}>Venue display</Link>
      </div>
      <p className="src">Anyone with this link can watch the overlay, like the venue display. It only reads what the public event page already shows. It cannot score, start a clock or change anything.</p>
    </section>
  );
}

function Sponsors({ eventId, sponsors, logoPaths, onChanged }: { eventId: string; sponsors: Sponsor[]; logoPaths: Record<string, string | null>; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState('');
  const [tier, setTier] = useState<'title' | 'partner'>('partner');
  const file = useRef<HTMLInputElement>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); onChanged(); } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); } finally { setBusy(false); }
  };
  const next = sponsors.length === 0 ? 1 : Math.max(...sponsors.map(s => s.sortOrder)) + 1;
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) { setMsg({ ok: false, text: 'Give the sponsor a name (at least 2 letters).' }); return; }
    void run(async () => {
      const picked = file.current?.files?.[0];
      const logoPath = picked ? await uploadSponsorLogo(eventId, picked) : null;
      await saveSponsor(eventId, { name: n, logoPath, link: null, tier, sort: next, onBroadcast: true });
      setName(''); if (file.current) file.current.value = '';
    }, 'Sponsor added.');
  };
  return (
    <section className="panel info" style={{ display: 'grid', gap: 14 }} aria-label="Sponsors">
      <h3>Sponsors ({sponsors.length})</h3>
      <p className="src">Shown on the overlay in rotation. A title sponsor is always shown; partners rotate. A sponsor's logo is a small picture (PNG, JPEG or WebP).</p>
      {sponsors.length === 0 && <p>No sponsors yet.</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {sponsors.map(s => (
          <li key={s.id} className="panel" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 10 }}>
            {s.logoUrl ? <img src={s.logoUrl} alt="" style={{ height: 40, maxWidth: 120, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 2 }} /> : <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--line)', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{s.name.slice(0, 1).toUpperCase()}</span>}
            <span style={{ flex: '1 1 140px', minWidth: 0 }}><b>{s.name}</b> <span className="chip">{s.tier === 'title' ? 'Title' : 'Partner'}</span>{!s.onBroadcast && <span className="chip"> Hidden</span>}</span>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => run(() => saveSponsor(eventId, { id: s.id, name: s.name, logoPath: logoPaths[s.id] ?? null, link: s.linkUrl, tier: s.tier, sort: s.sortOrder, onBroadcast: !s.onBroadcast }), s.onBroadcast ? 'Hidden from the overlay.' : 'Shown on the overlay.')}>{s.onBroadcast ? 'Hide' : 'Show'}</button>
            <button type="button" className="btn btn-line" disabled={busy} aria-label={`Remove ${s.name}`} onClick={() => run(() => removeSponsor(s.id, logoPaths[s.id] ?? null), `${s.name} removed.`)}>Remove</button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} noValidate style={{ display: 'grid', gap: 10 }} aria-label="Add a sponsor">
        <label className="field-in">Sponsor name<input value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>
        <label className="field-in">Level
          <select value={tier} onChange={e => setTier(e.target.value as 'title' | 'partner')}><option value="partner">Partner</option><option value="title">Title sponsor</option></select>
        </label>
        <label className="field-in">Logo (optional)<input ref={file} type="file" accept="image/png,image/jpeg,image/webp" /></label>
        <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Saving…' : 'Add sponsor'}</button>
      </form>
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--win)' : 'var(--live)' }}>{msg.text}</p>}
    </section>
  );
}
