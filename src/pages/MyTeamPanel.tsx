import { Chip } from '../components/ui';
import { fetchMyTeamRosters } from '../data/teams';
import { friendlyError } from '../lib/friendlyError';
import { missingItems, sortForChasing, summarizeClearance } from '../lib/teamClearance';
import { useAsync } from '../lib/useAsync';

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
          <section key={team.teamId} className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby={`myteam-${team.teamId}`}>
            <h3 id={`myteam-${team.teamId}`}>My team: {team.teamName}</h3>
            {team.rows.length === 0 ? <p className="muted">Your team is entered, but nobody has registered under it yet.</p> : (
              <>
                <p>
                  <b>{s.ready}</b> of <b>{s.total}</b> ready.
                  {s.missingWaiver > 0 && <> {s.missingWaiver} without a waiver.</>}
                  {s.missingInsurance > 0 && <> {s.missingInsurance} without insurance cover.</>}
                  {s.notCheckedIn > 0 && <> {s.notCheckedIn} not checked in yet.</>}
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                  {sortForChasing(team.rows).map(r => {
                    const todo = missingItems(r);
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
            <p className="src">Only names and status are shown here. Health and contact details stay with the organizers.</p>
          </section>
        );
      })}
    </>
  );
}
