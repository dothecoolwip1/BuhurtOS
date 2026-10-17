import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip } from './ui';
import type { LiveCompetition } from '../data/api';
import { fetchOfficialResults, type OfficialResult } from '../data/finalization';
import { fetchEntryRoster } from '../data/fighters';
import { buildPodium, placeWord, pointsText, representedLine, type PodiumStep } from '../lib/finalization';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

const sinceText = (iso: string | null | undefined): string | null => (iso ? new Date(iso).toLocaleDateString('en-CA', { dateStyle: 'medium' }) : null);

/**
 * The official placings of an event's competitions: a podium (champion, silver, bronze; a shared place on one step; no invented bronze) and the full
 * results, read from one public view. Team competitions name the team as it was at the event (and its roster on request); individual competitions
 * name the fighter, with the team they represented underneath. Only competitions that are official are shown; `version` re-reads after a change.
 */
export function OfficialResults({ competitions, version = 0, heading = 'Official results', emptyText, reported = false }: {
  competitions: readonly LiveCompetition[]; version?: number; heading?: string | null; emptyText?: string;
  /** Past medals (medals-only tournaments): the placings were reported by the fighters, not fought here, so they are not called official. */
  reported?: boolean;
}) {
  const official = useMemo(() => competitions.filter(c => c.status === 'finished'), [competitions]);
  const ids = official.map(c => c.id);
  const rows = useAsync(() => fetchOfficialResults(ids), [ids.join(',')], [version]);
  if (official.length === 0) return emptyText ? <p className="muted">{emptyText}</p> : null;
  return (
    <section aria-labelledby={heading ? 'official-h' : undefined} className="ofc-wrap" style={{ display: 'grid', gap: 14 }}>
      {heading && <h2 id="official-h">{heading}</h2>}
      {rows.loading && rows.data === undefined && <p className="muted">Loading the official results…</p>}
      {rows.error != null && <p role="alert">{friendlyError(rows.error, 'Could not load the official results.')}</p>}
      {rows.data && official.map(c => <CompetitionResults key={c.id} competition={c} rows={rows.data!.filter(r => r.competitionId === c.id)} reported={reported} />)}
    </section>
  );
}

export function CompetitionResults({ competition, rows, reported = false }: { competition: LiveCompetition; rows: OfficialResult[]; reported?: boolean }) {
  const podium = useMemo(() => buildPodium(rows), [rows]);
  const since = reported ? null : sinceText(competition.finalizedAt);
  return (
    <section id={`results-${competition.id}`} className="panel info ofc" aria-labelledby={`ofc-h-${competition.id}`}>
      <div className="ofc-head">
        <h3 id={`ofc-h-${competition.id}`}>{competition.name}</h3>
        {reported ? <Chip>Reported by the fighters</Chip> : <Chip tone="win">Official</Chip>}
        {since && <span className="src">since {since}</span>}
      </div>
      {rows.length === 0 && <p className="muted">{reported ? 'No medals have been added in this discipline yet.' : 'No placings are recorded.'}</p>}
      {podium.steps.length > 0 && (
        <ol className={`podium ${podium.steps.length === 1 ? 'one' : podium.steps.length === 2 ? 'two' : ''}`.trim()} aria-label={`${competition.name}: podium`}>
          {podium.steps.map(s => <Step key={s.place} step={s} />)}
        </ol>
      )}
      {podium.rest.length > 0 && (
        <details className="ofc-rest" open={podium.rest.length <= 6}>
          <summary><b>Full results</b> · {podium.total} {podium.total === 1 ? 'placing' : 'placings'}</summary>
          <ol className="pd-list" aria-label={`${competition.name}: full results`}>
            {podium.rest.flatMap(group => group.entries.map(r => (
              <li key={r.entryId} className="pd-row">
                <span className="rk" aria-label={placeWord(group.place, group.shared)}>{group.place}</span>
                <span style={{ minWidth: 0 }}>
                  <Name r={r} />
                  <span className="pd-sub">{group.shared ? `${placeWord(group.place, true)} · ` : ''}{subline(r)}</span>
                  {r.kind === 'team' && <Roster entryId={r.entryId} teamName={r.name} />}
                </span>
                <span className="pd-pts" aria-label={`${pointsText(r.points)} points`}>{pointsText(r.points)}</span>
              </li>
            )))}
          </ol>
        </details>
      )}
    </section>
  );
}

function Step({ step }: { step: PodiumStep<OfficialResult> }) {
  return (
    <li className={`pd-step ${step.medal}`}>
      <span className="pd-place" aria-hidden="true">{step.place}</span>
      <span className="pd-label">{step.label}{step.shared ? ' · shared' : ''}</span>
      {step.entries.map(r => (
        <span key={r.entryId} className="pd-entry">
          <Name r={r} />
          <span className="pd-sub">{subline(r)}</span>
          {r.kind === 'team' && <Roster entryId={r.entryId} teamName={r.name} />}
          <span className="pd-pts" aria-label={`${pointsText(r.points)} points`}>{pointsText(r.points)} <small>pts</small></span>
        </span>
      ))}
    </li>
  );
}

function Name({ r }: { r: OfficialResult }) {
  const to = r.kind === 'team' ? (r.teamSlug ? `/teams/${r.teamSlug}` : null) : r.fighterId ? `/fighters/${r.fighterId}` : null;
  return <span className="pd-name">{to ? <Link to={to}>{r.name}</Link> : r.name}{r.entryStatus === 'disqualified' && <> <Chip tone="live">Disqualified</Chip></>}</span>;
}
function subline(r: OfficialResult): string {
  if (r.kind === 'team') return r.teamCurrentName && r.teamCurrentName !== r.name ? `now ${r.teamCurrentName}` : 'Team';
  return representedLine(r) ?? '';
}

/** The roster that stood on the field for a team entry (historical, from entry_roster), on request. */
function Roster({ entryId, teamName }: { entryId: string; teamName: string }) {
  const [open, setOpen] = useState(false);
  const roster = useAsync(() => (open ? fetchEntryRoster(entryId) : Promise.resolve(undefined)), [open, entryId]);
  return (
    <span className="pd-roster">
      <button type="button" className="linklike" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide roster' : 'Roster at this event'}</button>
      {open && roster.data && (
        <ul className="plain" aria-label={`${teamName}: roster at this event`}>
          {roster.data.length === 0 && <li className="muted">No roster was recorded.</li>}
          {roster.data.map(m => <li key={m.fighterId}><Link to={`/fighters/${m.fighterId}`}>{m.displayName}</Link>{m.role === 'mercenary' && <span className="muted"> · mercenary{m.permanentTeamName ? ` from ${m.permanentTeamName}` : ''}</span>}{m.role === 'guest' && <span className="muted"> · guest</span>}</li>)}
        </ul>
      )}
      {open && roster.error != null && <span className="muted"> Could not load the roster.</span>}
    </span>
  );
}
