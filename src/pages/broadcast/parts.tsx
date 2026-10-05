import { Crest } from '../../components/Crest';
import type { ArenaFight } from '../../lib/arena';
import { MODE_LABEL, formatClock, remainingMs, type ServerClock, type TimerMode } from '../../lib/lyst/timer';
import { useNow } from '../../lib/lyst/useLystState';
import type { SidePresentation } from '../../lib/broadcast/sides';
import { visibleSponsors, type Sponsor } from '../../lib/broadcast/sponsors';
import type { Scene, SceneClock } from '../../lib/broadcast/state';

/** Broadcast building blocks. Presentation only: every value arrives already derived from server state. */

export function Portrait({ p, size }: { p: SidePresentation; size: number }) {
  if (p.avatarUrl) return <img className="bc-photo" src={p.avatarUrl} width={size} height={size} alt="" style={{ width: size, height: size }} />;
  if (p.crest) return <span className="bc-crest" style={{ width: size, height: size }}><Crest team={p.crest} size={Math.round(size * 0.82)} /></span>;
  return <span className="bc-crest bc-letter" style={{ width: size, height: size, background: p.corner.color, color: p.corner.ink }} aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>;
}

const MARK_CLASS: Record<string, string> = { warning: 'is-warn', card: 'is-card', deduction: 'is-ded', dq: 'is-dq' };
export function Marks({ fight, side }: { fight: ArenaFight; side: 'a' | 'b' }) {
  const marks = fight.lyst?.marks.filter(m => m.side === side) ?? [];
  if (marks.length === 0) return null;
  return <span className="bc-marks">{marks.map((m, i) => <b key={i} className={`bc-mark ${MARK_CLASS[m.kind] ?? ''}`}>{m.text}</b>)}</span>;
}

/** The official clock, from server state and the measured server offset. */
export function ClockView({ clock, server, big = false }: { clock: SceneClock; server: ServerClock; big?: boolean }) {
  const running = clock.status === 'running';
  const now = useNow(running, 100);
  const left = remainingMs({ status: clock.status, remaining_ms: clock.remainingMs, started_at: clock.startedAt }, server.now(now));
  const label = MODE_LABEL[clock.mode as TimerMode] ?? 'Clock';
  return (
    <span className={`bc-clock${big ? ' is-big' : ''} ${running ? (left <= 10_000 ? 'is-low' : 'is-run') : 'is-hold'}`} role="timer" aria-label={`${label} ${formatClock(left)}`}>
      <b className="bc-clock-n">{formatClock(left)}</b>
    </span>
  );
}

const RIBBON: Record<string, string> = {
  live: 'LIVE', paused: 'CLOCK PAUSED', break: 'BREAK', equipment: 'EQUIPMENT TIMEOUT', dq_clock: 'DISQUALIFICATION COUNTDOWN', disqualified: 'DISQUALIFICATION', ready: 'GET READY', complete: 'MATCH COMPLETE', winner: 'FINAL'
};

/** The score bug: both sides, the official score, the round, the clock and the state ribbon. */
export function Scorebug({ scene, a, b, server }: { scene: Scene; a: SidePresentation; b: SidePresentation; server: ServerClock }) {
  const f = scene.fight;
  if (!f) return null;
  const confirming = f.lyst?.roundStatus === 'confirming';
  const sideEl = (p: SidePresentation, k: 'a' | 'b') => (
    <div className={`bc-side ${k}${scene.winner?.side === k ? ' is-winner' : ''}${scene.disqualified === k ? ' is-dq' : ''}`} style={{ ['--corner' as string]: p.corner.color, ['--corner-ink' as string]: p.corner.ink }}>
      <span className="bc-stripe" aria-hidden="true"><i>{p.corner.label}</i></span>
      <Portrait p={p} size={92} />
      <span className="bc-who">
        <b className="bc-name">{p.name}</b>
        <span className="bc-sub">{[p.subtitle, p.record ? `${p.record}` : null].filter(Boolean).join('  ·  ')}</span>
        <Marks fight={f} side={k} />
      </span>
      <b className="bc-score" aria-label={`${p.name} ${f[k].score ?? 0}`}>{f[k].score ?? 0}</b>
    </div>
  );
  return (
    <div className="bc-bug" data-mode={scene.mode}>
      {sideEl(a, 'a')}
      <div className="bc-mid">
        <span className="bc-round">{scene.round ? `ROUND ${scene.round}` : f.stage.toUpperCase()}</span>
        {scene.clock && scene.mode !== 'complete' && scene.mode !== 'winner' ? <ClockView clock={scene.clock} server={server} /> : <span className="bc-clock is-hold"><b className="bc-clock-n">{scene.mode === 'complete' || scene.mode === 'winner' ? 'FINAL' : '–:––'}</b></span>}
        <span className={`bc-ribbon is-${scene.mode}`}>{confirming && scene.mode === 'break' ? 'SCORES BEING CONFIRMED…' : RIBBON[scene.mode] ?? scene.label.toUpperCase()}</span>
      </div>
      {sideEl(b, 'b')}
    </div>
  );
}

const Corner = ({ p }: { p: SidePresentation }) => <span className="bc-corner" style={{ background: p.corner.color, color: p.corner.ink }}>{p.corner.label}</span>;

function FighterCard({ p, wins = false }: { p: SidePresentation; wins?: boolean }) {
  return (
    <div className={`bc-card${wins ? ' is-winner' : ''}`} style={{ ['--corner' as string]: p.corner.color }}>
      <Corner p={p} />
      <Portrait p={p} size={168} />
      <b className="bc-card-name">{p.name}</b>
      {p.subtitle && <span className="bc-card-sub">{p.subtitle}</span>}
      {p.record && <span className="bc-card-rec"><i>RECORD</i> {p.record}{p.recordNote ? <small> ({p.recordNote})</small> : null}</span>}
    </div>
  );
}

/** Fight introduction / up next: the two sides facing each other, bottom of the screen. */
export function LowerThird({ kicker, fight, a, b, field }: { kicker: string; fight: ArenaFight; a: SidePresentation; b: SidePresentation; field: string }) {
  return (
    <section className="bc-lower" aria-label={kicker}>
      <span className="bc-kicker">{kicker}</span>
      <div className="bc-faceoff"><FighterCard p={a} /><span className="bc-vs">VS</span><FighterCard p={b} /></div>
      <span className="bc-foot">{fight.competition} · {fight.stage} · {field}</span>
    </section>
  );
}

/** The result: the winner large, the final score, and what comes next. */
export function WinnerCard({ scene, a, b, kicker }: { scene: Scene; a: SidePresentation; b: SidePresentation; kicker: string }) {
  const f = scene.fight!;
  const w = scene.winner;
  const win = w?.side === 'a' ? a : w?.side === 'b' ? b : null;
  return (
    <section className="bc-winner" aria-label="Result">
      <span className="bc-kicker is-win">{kicker}</span>
      {win ? <div className="bc-winner-main"><Portrait p={win} size={220} /><div><span className="bc-winner-k">WINNER</span><b className="bc-winner-name">{win.name}</b>{win.subtitle && <span className="bc-card-sub">{win.subtitle}</span>}</div></div>
        : <b className="bc-winner-name">DRAW</b>}
      <div className="bc-final"><b>{a.name}</b><i>{f.a.score ?? 0}</i><span>–</span><i>{f.b.score ?? 0}</i><b>{b.name}</b></div>
    </section>
  );
}

const QueueRow = ({ label, f, na, nb }: { label: string; f: ArenaFight | null; na: string; nb: string }) => (
  <div className="bc-q-row"><span className="bc-q-k">{label}</span>{f ? <><b className="bc-q-n">{na} <i>vs</i> {nb}</b><span className="bc-q-c">{f.competition} · {f.stage}</span></> : <b className="bc-q-n is-none">—</b>}</div>
);
export function QueuePanel({ scene, names }: { scene: Scene; names: (f: ArenaFight) => [string, string] }) {
  const row = (label: string, f: ArenaFight | null) => <QueueRow key={label} label={label} f={f} na={f ? names(f)[0] : ''} nb={f ? names(f)[1] : ''} />;
  const showNow = scene.fight && scene.mode !== 'winner' && scene.mode !== 'complete';
  return (
    <aside className="bc-queue" aria-label="Fight order">
      <span className="bc-q-h">{scene.field}</span>
      {showNow ? row('NOW', scene.fight) : null}
      {row('UP NEXT', scene.next)}
      {scene.following.slice(0, 2).map((f, i) => row(i === 0 ? 'THEN' : 'AFTER', f))}
    </aside>
  );
}

export function SponsorStrip({ sponsors, nowMs, seconds, big = false }: { sponsors: readonly Sponsor[]; nowMs: number; seconds: number; big?: boolean }) {
  const v = visibleSponsors(sponsors, nowMs, seconds, big ? 5 : 3);
  const one = (s: Sponsor, title: boolean) => (
    <span key={s.id} className={`bc-sp${title ? ' is-title' : ''}`}>{s.logoUrl ? <img src={s.logoUrl} alt={s.name} /> : <b>{s.name}</b>}</span>
  );
  if (v.title.length === 0 && v.partners.length === 0) return null;
  return <div className={`bc-sponsors${big ? ' is-big' : ''}`} aria-label="Sponsors" key={v.page}>{v.title.map(s => one(s, true))}{v.partners.map(s => one(s, false))}</div>;
}
