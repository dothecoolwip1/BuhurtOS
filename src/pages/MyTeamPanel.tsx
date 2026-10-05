import { useEffect, useState } from 'react';
import { Chip } from '../components/ui';
import { fetchTeamReadiness, type TeamReadinessRow } from '../data/readiness';
import { fetchMyTeamRosters } from '../data/teams';
import { teamSummary } from '../lib/readiness';
import { friendlyError } from '../lib/friendlyError';
import { missingItems, sortForChasing, summarizeClearance } from '../lib/teamClearance';
import { useAsync } from '../lib/useAsync';

const REFRESH_MS = 30_000;

/** Pack 16: the team's event-day readiness (the same rule as the desk and the Lyst screen). Captains see it; they cannot change it. Null until loaded or if it cannot load. */
function useTeamReadiness(eventId: string, teamId: string): TeamReadinessRow[] | null {
  const [rows, setRows] = useState<TeamReadinessRow[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => { void fetchTeamReadiness(eventId, teamId).then(r => { if (live) setRows(r); }).catch(() => { /* keep the paperwork view */ }); };
    load();
    const t = window.setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    window.addEventListener('online', load); window.addEventListener('focus', load);
    return () => { live = false; window.clearInterval(t); window.removeEventListener('online', load); window.removeEventListener('focus', load); };
  }, [eventId, teamId]);
  return rows;
}

function TeamDay({ eventId, teamId, children }: { eventId: string; teamId: string; children: (day: Map<string, TeamReadinessRow> | null, summary: string | null) => React.ReactNode }) {
  const rows = useTeamReadiness(eventId, teamId);
  const accepted = rows?.filter(r => r.reasons[0] !== 'Registration not accepted' && r.reasons[0] !== 'Withdrawn') ?? null;
  return <>{children(rows ? new Map(rows.map(r => [r.registrationId, r])) : null, accepted && accepted.some(r => !r.isVolunteer) ? teamSummary(accepted) : null)}</>;
}

/**
 * Event workspace panel for a signed-in captain: their team's registered people and who still lacks waiver, insurance or check-in.
 * Renders nothing for anyone who captains no team registered in this event. Shows no health or contact data.
 */
export function MyTeamPanel({ eventId, userId }: { eventId: string; userId: string | undefined }) {
  const rosters = useAsync(() => (userId ? fetchMyTeamRosters(eventId) : Promise.resolve([])), [eventId, userId]);
  if (!userId) return null;
  if (rosters.error != null) return <p role="alert">{friendlyError(rosters.error, 'Could not load your team.')}</p>;
  const list = rosters.data ?? [];
  if (list.length === 0) return null;
  return (
    <>
      {list.map(team => {
        const s = summarizeClearance(team.rows);
        return (
          <TeamDay key={team.teamId} eventId={eventId} teamId={team.teamId}>{(day, daySummary) => (
          <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby={`myteam-${team.teamId}`}>
            <h3 id={`myteam-${team.teamId}`}>My team: {team.teamName}</h3>
            {team.rows.length === 0 ? <p className="muted">Your team is entered, but nobody has registered under it yet.</p> : (
              <>
                {daySummary && <p data-testid="team-day"><b>On the day:</b> {daySummary}</p>}
                <p>
                  {day ? <>Paperwork: <b>{s.ready}</b> of <b>{s.total}</b> complete.</> : <><b>{s.ready}</b> of <b>{s.total}</b> ready.</>}
                  {s.missingWaiver > 0 && <> {s.missingWaiver} without a waiver.</>}
                  {s.missingInsurance > 0 && <> {s.missingInsurance} without insurance cover.</>}
                  {s.notCheckedIn > 0 && <> {s.notCheckedIn} not checked in yet.</>}
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                  {sortForChasing(team.rows).map(r => {
                    const todo = missingItems(r);
                    const d = day?.get(r.registrationId);
                    if (d && r.status === 'accepted') {
                      // The event-day answer replaces the check-in and kit items; a missing waiver is still worth chasing.
                      const paper = r.waiverSigned ? [] : ['Waiver'];
                      return (
                        <li key={r.registrationId} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <b style={{ overflowWrap: 'anywhere' }}>{r.fullName}</b>
                          {r.isVolunteer && <Chip>Volunteer</Chip>}
                          {d.ready ? <Chip tone="win">✓ Ready</Chip> : <Chip tone="brass">✕ Not ready</Chip>}
                          {!d.ready && d.reasons.length > 0 && <span className="src">{d.reasons.join(' · ')}</span>}
                          {paper.length > 0 && <span className="src">Missing: {paper.join(' · ')}</span>}
                        </li>
                      );
                    }
                    return (
                      <li key={r.registrationId} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <b style={{ overflowWrap: 'anywhere' }}>{r.fullName}</b>
                        {r.isVolunteer && <Chip>Volunteer</Chip>}
                        {todo.length === 0 ? <Chip tone="win">Ready</Chip> : <span className="src">Missing: {todo.join(' · ')}</span>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <p className="src">Only names and status are shown here. Health and contact details stay with the organizers.{day ? ' Check-in and armour are recorded by the event desk; ask them if something looks wrong.' : ''}</p>
          </section>
          )}</TeamDay>
        );
      })}
    </>
  );
}
