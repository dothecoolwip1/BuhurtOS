import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LowerThird, QueuePanel, Scorebug, SponsorStrip, WinnerCard, ClockView } from './parts';
import type { ArenaFight } from '../../lib/arena';
import { presentSide, type SidePresentation } from '../../lib/broadcast/sides';
import { useBroadcast } from '../../lib/broadcast/useBroadcast';

export const STAGE_W = 1920, STAGE_H = 1080;
type Layout = 'full' | 'bug' | 'queue' | 'sponsors';
const LAYOUTS: Layout[] = ['full', 'bug', 'queue', 'sponsors'];
const BG: Record<string, string> = { transparent: 'transparent', green: '#00B140', dark: '#0B0E13' };

/** Scale the fixed 1920x1080 stage to the browser source (letterboxed, never cropped). `scale=1` keeps pixels 1:1. */
function useStageScale(fit: boolean): { k: number; x: number; y: number } {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => { const on = () => setSize({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  if (!fit) return { k: 1, x: 0, y: 0 };
  const k = Math.min(size.w / STAGE_W, size.h / STAGE_H);
  return { k, x: Math.max(0, (size.w - STAGE_W * k) / 2), y: Math.max(0, (size.h - STAGE_H * k) / 2) };
}

/**
 * The broadcast overlay: a browser source for OBS and similar software. Public and READ-ONLY. It reads the same state as the venue display (nobody operates it)
 * and draws it for video: a fixed 1920x1080 stage, transparent by default, large type, restrained motion. It never writes to the server and holds no state of its own
 * beyond what it last read; whenever the server answers again, the screen follows the server.
 *   /broadcast/<event>/<field>?layout=full|bug|queue|sponsors&bg=transparent|green|dark&scale=fit|1&status=1
 */
export function BroadcastPage() {
  const { eventId: slug = '', field: fieldParam } = useParams();
  const [q] = useSearchParams();
  const layout: Layout = (LAYOUTS.find(l => l === q.get('layout')) ?? 'full');
  const bgKey = q.get('bg') ?? 'transparent';
  const showStatus = q.get('status') === '1';
  const d = useBroadcast(slug, fieldParam ?? q.get('field'));
  const { k, x, y } = useStageScale(q.get('scale') !== '1');

  // the page is a transparent layer: nothing of the site chrome, no scrolling, no selection
  useEffect(() => {
    const prev = [document.documentElement.style.background, document.body.style.background, document.body.style.overflow];
    const bg = BG[bgKey] ?? 'transparent';
    document.documentElement.style.background = bg; document.body.style.background = bg; document.body.style.overflow = 'hidden';
    document.documentElement.classList.add('bc-html');
    return () => { [document.documentElement.style.background, document.body.style.background, document.body.style.overflow] = prev; document.documentElement.classList.remove('bc-html'); };
  }, [bgKey]);

  const scene = d.scene;
  const opts = useMemo(() => ({ scheme: d.settings.corners, records: d.settings.showRecords, photos: d.settings.showPhotos }), [d.settings]);
  const sideOf = (f: ArenaFight, k2: 'a' | 'b'): SidePresentation => presentSide(d.sides[(k2 === 'a' ? f.entryA : f.entryB) ?? ''] ?? null, k2, f[k2].name, opts);
  const namesOf = (f: ArenaFight): [string, string] => [sideOf(f, 'a').name, sideOf(f, 'b').name];
  const nowMs = d.clock.now(Date.now());
  const sponsors = d.settings.showSponsors ? d.sponsors : [];

  const mode = scene?.mode ?? 'idle';
  const liveLike = ['live', 'paused', 'break', 'equipment', 'dq_clock', 'disqualified'].includes(mode);
  const stage = (() => {
    if (!scene || !d.event) return null;
    if (layout === 'sponsors') return <div className="bc-only-sponsors"><SponsorStrip sponsors={sponsors} nowMs={nowMs} seconds={d.settings.sponsorSeconds} big /></div>;
    if (layout === 'queue') return <QueuePanel scene={scene} names={namesOf} />;
    const f = scene.fight, next = scene.next;
    const bug = f && (liveLike || mode === 'complete') ? <Scorebug key="bug" scene={scene} a={sideOf(f, 'a')} b={sideOf(f, 'b')} server={d.clock} /> : null;
    if (layout === 'bug') return f && (liveLike || mode === 'complete' || mode === 'winner') ? <Scorebug key="bug" scene={scene} a={sideOf(f, 'a')} b={sideOf(f, 'b')} server={d.clock} /> : null;
    return (
      <>
        <div className={`bc-tag${bug ? ' is-under' : ''}`}><b>{d.event.name}</b>{f ? <span>{f.competition}</span> : next ? <span>{next.competition}</span> : null}</div>
        {bug}
        {(mode === 'intro' || mode === 'ready') && f && (
          <LowerThird kicker={mode === 'ready' ? 'GET READY' : 'NOW ON THE FIELD'} fight={f} a={sideOf(f, 'a')} b={sideOf(f, 'b')} field={scene.field} />
        )}
        {mode === 'ready' && scene.clock && <div className="bc-ready-clock"><ClockView clock={scene.clock} server={d.clock} big /></div>}
        {(mode === 'complete' || mode === 'winner') && f && <WinnerCard scene={scene} a={sideOf(f, 'a')} b={sideOf(f, 'b')} kicker={mode === 'complete' ? 'MATCH COMPLETE' : 'RESULT'} />}
        {(mode === 'upcoming' || mode === 'between') && next && (
          <LowerThird kicker={mode === 'upcoming' ? 'NEXT FIGHT' : 'UP NEXT'} fight={next} a={sideOf(next, 'a')} b={sideOf(next, 'b')} field={scene.field} />
        )}
        {mode === 'idle' && <div className="bc-idle"><span>{d.event.name}</span><b>{scene.total > 0 && scene.done >= scene.total ? `${scene.field} is complete` : 'Stand by'}</b></div>}
        {!liveLike && mode !== 'idle' && <QueuePanel scene={scene} names={namesOf} />}
        {liveLike && next && <div className="bc-nextchip"><i>NEXT</i><b>{namesOf(next).join('  vs  ')}</b></div>}
        <div className={`bc-sp-slot${liveLike ? ' is-live' : ''}`}><SponsorStrip sponsors={sponsors} nowMs={nowMs} seconds={d.settings.sponsorSeconds} big={mode === 'idle'} /></div>
      </>
    );
  })();

  return (
    <div className="bc" data-scene={mode} data-layout={layout} data-stale={d.stale ? 'true' : 'false'} data-connection={d.connection} data-ready={d.loading || (!scene && !d.error && !d.notPublic) ? 'false' : 'true'} data-field={d.field}>
      <div className="bc-stage" style={{ width: STAGE_W, height: STAGE_H, transform: `translate(${x}px, ${y}px) scale(${k})` }}>
        {stage}
        {showStatus && (
          <span className={`bc-status${d.stale ? ' is-stale' : ''}`} role="status">
            {d.loading ? 'loading' : d.error ? 'error' : d.notPublic ? 'event not public' : d.stale ? 'reconnecting' : 'live'} · {scene?.mode ?? '—'}
          </span>
        )}
      </div>
    </div>
  );
}
