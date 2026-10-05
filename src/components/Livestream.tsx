import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBroadcastConfig } from '../data/broadcast';
import { useAsync } from '../lib/useAsync';
import { useBroadcast } from '../lib/broadcast/useBroadcast';
import { presentSide } from '../lib/broadcast/sides';
import { parseStream } from '../lib/broadcast/stream';
import { ClockView } from '../pages/broadcast/parts';
import type { ArenaFight } from '../lib/arena';

/**
 * The livestream on the public event page: the organizer's stream (allow-listed YouTube / Twitch / Vimeo only), with the live fight, the official clock and the
 * next fight beside it. Read-only and built from the same state as the venue display and the broadcast overlay: nothing here is a second source of truth.
 * An event with no stream address shows nothing at all (and loads nothing more than one small row).
 */
export function Livestream({ eventId, slug, published }: { eventId: string; slug: string; published: boolean }) {
  const cfg = useAsync(() => (published ? fetchBroadcastConfig(eventId) : Promise.resolve(null)), [eventId, published]);
  const stream = cfg.data?.settings.streamUrl ? parseStream(cfg.data.settings.streamUrl, window.location.hostname) : null;
  if (!stream) return null;
  return <StreamBlock slug={slug} title={cfg.data?.settings.streamTitle || 'Watch live'} stream={stream} />;
}

const PROVIDER = { youtube: 'YouTube', twitch: 'Twitch', vimeo: 'Vimeo' } as const;

function StreamBlock({ slug, title, stream }: { slug: string; title: string; stream: NonNullable<ReturnType<typeof parseStream>> }) {
  const [pick, setPick] = useState<string | null>(null);
  const live = useBroadcast(slug, pick);
  const scene = live.scene;
  const name = (f: ArenaFight, k: 'a' | 'b') => presentSide(live.sides[(k === 'a' ? f.entryA : f.entryB) ?? ''] ?? null, k, f[k].name, { scheme: live.settings.corners, records: false, photos: false }).name;
  const f = scene?.fight ?? null;
  const showFight = f && scene && ['live', 'paused', 'break', 'equipment', 'dq_clock', 'disqualified', 'complete', 'winner'].includes(scene.mode);
  const nextUp = scene?.next ?? null;
  return (
    <section className="panel info ls" aria-labelledby="ls-h" style={{ display: 'grid', gap: 12 }}>
      <h2 id="ls-h">{title} <span className="chip live">{PROVIDER[stream.provider]}</span></h2>
      {stream.embedUrl
        ? <div className="ls-frame"><iframe src={stream.embedUrl} title={`${title} (${PROVIDER[stream.provider]})`} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox" /></div>
        : <a className="btn btn-ink" href={stream.watchUrl} target="_blank" rel="noreferrer noopener">Watch the stream on {PROVIDER[stream.provider]}</a>}
      {stream.embedUrl && <a className="src" href={stream.watchUrl} target="_blank" rel="noreferrer noopener">Open on {PROVIDER[stream.provider]}</a>}
      {live.fields.length > 1 && (
        <div className="ls-fields" role="group" aria-label="Field">
          {live.fields.map(fl => <button key={fl} type="button" className={`btn btn-line${fl === live.field ? ' on' : ''}`} aria-pressed={fl === live.field} onClick={() => setPick(fl)}>{fl}</button>)}
        </div>
      )}
      {scene && (
        <div className="ls-board" role="status" aria-live="polite" data-scene={scene.mode}>
          <span className="ls-state">{scene.label}</span>
          {showFight && f ? (
            <div className="ls-match">
              <span className="ls-side"><b>{name(f, 'a')}</b><i className={scene.winner?.side === 'a' ? 'win' : ''}>{f.a.score ?? 0}</i></span>
              {scene.clock && scene.mode !== 'complete' && scene.mode !== 'winner' ? <ClockView clock={scene.clock} server={live.clock} /> : <span className="ls-final">FINAL</span>}
              <span className="ls-side b"><i className={scene.winner?.side === 'b' ? 'win' : ''}>{f.b.score ?? 0}</i><b>{name(f, 'b')}</b></span>
            </div>
          ) : nextUp ? <p className="ls-now"><b>{name(nextUp, 'a')}</b> vs <b>{name(nextUp, 'b')}</b></p> : <p className="ls-now">Stand by</p>}
          {scene.round && showFight && <span className="src">Round {scene.round} · {f?.competition}</span>}
          {nextUp && showFight && <p className="src">Next: {name(nextUp, 'a')} vs {name(nextUp, 'b')}</p>}
        </div>
      )}
      <p className="src"><Link to={`/events/${slug}/arena`}>Venue display</Link> · official results appear below once the marshals confirm them.</p>
    </section>
  );
}
