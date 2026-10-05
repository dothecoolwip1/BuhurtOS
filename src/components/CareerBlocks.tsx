import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CareerLine, Fight, TeamFight } from '../data/careerProfile';
import type { RankingRow } from '../data/fighters';
import { fightLine, fightWord, formLetters, medalsText, outcomeWord, placeWord, pointsText, recordText, type CareerFilter, type Highlight } from '../lib/careerProfile';
import { divisionLabel, winPctText, type Medal, type Outcome } from '../lib/careerView';
import { dateRange } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import type { AsyncState } from '../lib/useAsync';
import { Chip, Seg, TestBadge } from './ui';

/** Pack 10: the blocks the fighter and team career profiles are built from. Presentation only; every number arrives computed. */

/** A profile section with its own loading and error state. Hidden when empty, unless `keep` asks for an empty state. */
export function Block<T>({ title, state, empty, children, note, id, keep, aside }: { title: string; state: AsyncState<T>; empty: (d: T) => boolean; children: (d: T) => ReactNode; note?: ReactNode; id?: string; keep?: ReactNode; aside?: ReactNode }) {
  if (state.loading) return <section className="panel info" id={id} aria-busy="true"><h2 className="h3">{title}</h2><p className="muted">Loading…</p></section>;
  if (state.error != null) return <section className="panel info" id={id}><h2 className="h3">{title}</h2><p role="alert">{friendlyError(state.error, `Could not load ${title.toLowerCase()}.`)}</p></section>;
  if (state.data === undefined || empty(state.data)) return keep ? <section className="panel info" id={id}><h2 className="h3">{title}</h2>{keep}</section> : null;
  return (
    <section className="panel info" id={id} style={{ scrollMarginTop: 80 }}>
      <div className="rowline"><h2 className="h3">{title}</h2>{aside}</div>
      {children(state.data)}
      {note && <p className="muted" style={{ fontSize: 13 }}>{note}</p>}
    </section>
  );
}

export function Tile({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return <div className={wide ? 'statcell wide' : 'statcell'}><b>{value}</b><span>{label}</span></div>;
}

/** Career / season / organization choice. Rendered only when there is something to choose. */
export function FilterBar({ filters, value, onChange }: { filters: readonly CareerFilter[]; value: CareerFilter; onChange: (f: CareerFilter) => void }) {
  if (filters.length < 2) return null;
  const key = (f: CareerFilter) => `${f.kind}:${f.id ?? ''}`;
  return (
    <div className="evfilter careerfilter" role="region" aria-label="Show statistics for">
      <Seg label="Show statistics for" scroll value={key(value)} options={filters.map(f => [key(f), f.label] as const)} onChange={k => { const f = filters.find(x => key(x) === k); if (f) onChange(f); }} />
    </div>
  );
}

/** The headline numbers of a career (fighter or team). */
export function SummaryTiles({ t, team }: { t: CareerLine; team?: boolean }) {
  return (
    <div className="statgrid">
      <Tile label={team ? 'Events' : 'Events competed'} value={t.events} />
      <Tile label="Competitions" value={t.competitions} />
      <Tile label={team ? 'Team fights' : 'Fights'} value={t.matches} />
      <Tile label="Record" value={<span style={{ fontSize: 22 }}>{t.wins}–{t.losses}{t.draws > 0 ? `–${t.draws}` : ''}<span className="sr-only"> ({recordText(t)})</span></span>} />
      <Tile label="Win rate" value={winPctText(t.winPct)} />
      <Tile label="Gold" value={t.golds} />
      <Tile label="Silver" value={t.silvers} />
      <Tile label="Bronze" value={t.bronzes} />
      <Tile label="Podiums" value={t.podiums} />
      <Tile label="Ranking points" value={t.points} />
    </div>
  );
}

/** One line per discipline: fights, record, medals, points. Collapsible past the first few on a phone. */
export function DisciplineList({ lines, label }: { lines: readonly CareerLine[]; label: string }) {
  const [open, setOpen] = useState(false);
  const shown = open ? lines : lines.slice(0, 4);
  return (
    <>
      <ul className="plain disc" aria-label={label}>
        {shown.map(l => (
          <li key={`${l.kind}:${l.category}:${l.gender}`} className="discline">
            <span style={{ minWidth: 0 }}>
              <b>{l.categoryName ?? l.category}</b>{l.gender && l.gender !== 'open' && <> <Chip>{divisionLabel(l.gender)}</Chip></>}
              <span className="l">{fightWord(l.matches)} · {recordText(l)}{medalsText(l) && ` · ${medalsText(l)}`}</span>
            </span>
            <span className="pts"><b>{l.points}</b><span>{l.points === 1 ? 'point' : 'points'}</span></span>
          </li>
        ))}
      </ul>
      {lines.length > 4 && <button type="button" className="btn btn-line" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Show fewer' : `Show all ${lines.length}`}</button>}
    </>
  );
}

/** W / L / D strip, newest first, readable by a screen reader. */
export function FormStrip({ outcomes, label }: { outcomes: readonly Outcome[]; label: string }) {
  const letters = formLetters(outcomes.map(o => ({ outcome: o })), outcomes.length);
  return (
    <ol className="record" aria-label={label}>
      {letters.map((l, i) => <li key={i} className={`wl ${l === 'W' ? 'w' : l === 'L' ? 'l' : 'd'}`}><span aria-hidden="true">{l}</span><span className="sr-only">{outcomeWord(outcomes[i])}</span></li>)}
    </ol>
  );
}

export function MedalChip({ medal, place }: { medal: Medal | null; place: number }) {
  return <span className={`medal ${medal ?? ''}`}>{placeWord(place)}</span>;
}

/** One fight of a fighter: outcome, opponent (tap for head to head or the team), event, discipline, date, score. */
export function FightRow({ f, onOpponent, showTeam }: { f: Fight; onOpponent?: (fighterId: string) => void; showTeam?: boolean }) {
  const opponent = f.opponentName ?? 'Opponent not shown';
  const who = f.opponentFighterId && onOpponent
    ? <button type="button" className="linklike" onClick={() => onOpponent(f.opponentFighterId as string)} aria-label={`Head to head with ${opponent}`}>{opponent}</button>
    : f.opponentTeamSlug ? <Link to={`/teams/${f.opponentTeamSlug}`}>{opponent}</Link> : <span>{opponent}</span>;
  return (
    <li className="fightline">
      <span className={`chip ${f.outcome === 'win' ? 'win' : f.outcome === 'loss' ? 'loss' : ''}`}><span aria-hidden="true">{f.outcome === 'win' ? 'W' : f.outcome === 'loss' ? 'L' : 'D'}</span><span className="sr-only">{outcomeWord(f.outcome)}</span></span>
      <span style={{ minWidth: 0 }}>
        <b>vs {who}</b> <span className="muted">{fightLine(f)}</span>
        <span className="l"><Link to={`/events/${f.eventSlug}`}>{f.eventName}</Link> · {f.categoryName}{f.kind === 'team' && f.teamName ? ` · for ${f.teamName}` : showTeam && f.teamName ? ` · for ${f.teamName}` : ''} · {dateRange(f.startsOn, f.endsOn)}</span>
        {(f.synthetic || f.statsExcluded) && <span className="l"><TestBadge synthetic={f.synthetic} />{f.statsExcluded && <Chip>Not counted in statistics</Chip>}</span>}
      </span>
    </li>
  );
}

/** One team fight: outcome, opponent team, event, category, score, placing; the roster that fought it on request. */
export function TeamFightRow({ f, roster }: { f: TeamFight; roster: (entryId: string) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const opponent = f.opponentName ?? 'Opponent not shown';
  return (
    <li className="fightline">
      <span className={`chip ${f.outcome === 'win' ? 'win' : f.outcome === 'loss' ? 'loss' : ''}`}><span aria-hidden="true">{f.outcome === 'win' ? 'W' : f.outcome === 'loss' ? 'L' : 'D'}</span><span className="sr-only">{outcomeWord(f.outcome)}</span></span>
      <span style={{ minWidth: 0 }}>
        <b>vs {f.opponentTeamSlug ? <Link to={`/teams/${f.opponentTeamSlug}`}>{opponent}</Link> : opponent}</b> <span className="muted">{fightLine(f)}</span>
        <span className="l"><Link to={`/events/${f.eventSlug}`}>{f.eventName}</Link> · {f.categoryName}{f.roundLabel ? ` · ${f.roundLabel}` : ''} · {dateRange(f.startsOn, f.endsOn)}{f.finalPlace !== null && <> · finished <MedalChip medal={f.finalPlace <= 3 ? (['gold', 'silver', 'bronze'] as const)[f.finalPlace - 1] : null} place={f.finalPlace} /></>}</span>
        {(f.synthetic || f.statsExcluded) && <span className="l"><TestBadge synthetic={f.synthetic} />{f.statsExcluded && <Chip>Not counted in statistics</Chip>}</span>}
        <button type="button" className="btn btn-line" style={{ marginTop: 6 }} aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide roster' : 'Roster that day'}</button>
        {open && <div style={{ marginTop: 6 }}>{roster(f.entryId)}</div>}
      </span>
    </li>
  );
}

export function HighlightList({ items }: { items: readonly Highlight[] }) {
  return (
    <ul className="plain highlights">
      {items.map(h => <li key={h.label}><span className="eyebrow">{h.label}</span><span className="v">{h.to ? <Link to={h.to}>{h.value}</Link> : h.value}</span></li>)}
    </ul>
  );
}

/** "#2 Parkland League · Longsword · Men" lines for the hero. */
export function RankingLines({ rows, label, more }: { rows: readonly RankingRow[]; label: (r: RankingRow) => string; more: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="ranklines">
      <ul className="plain" aria-label="Ranking highlights">
        {rows.map((r, i) => <li key={i} className="rankline"><span className="rk">#{r.rank}</span><span style={{ minWidth: 0 }}>{label(r)}<span className="l">{pointsText(r.points)}</span></span></li>)}
      </ul>
      <Link className="more" to={more}>View all rankings →</Link>
    </div>
  );
}
