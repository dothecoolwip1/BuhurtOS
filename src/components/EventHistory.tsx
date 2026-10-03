import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip, Tabs, TestBadge } from './ui';
import { LiveBracket } from './LiveBracket';
import { LivePools } from './LivePools';
import { fetchEventHistory, fetchOrgLites, fetchSeasons, type EventMeta } from '../data/careers';
import type { LiveCompetition } from '../data/api';
import type { LiveState } from '../lib/useLiveMatches';
import { attendanceTotals, categoryLabel, divisionLabel, entriesByTeam, INACTIVE_ORG_NOTICE, medalOf, medalTable, orgName, placeText, plural } from '../lib/careerView';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

/** The organization chip (and the inactive notice) for any event that belongs to an organization. Renders nothing otherwise. */
export function EventOrganization({ meta }: { meta: EventMeta | null | undefined }) {
  const orgs = useAsync(fetchOrgLites, []);
  const seasons = useAsync(fetchSeasons, []);
  const org = (orgs.data ?? []).find(o => o.id === meta?.organizationId);
  if (!meta || !org) return null;
  const season = (seasons.data ?? []).find(s => s.id === meta.seasonId);
  return (
    <>
      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link to={`/rankings?scope=org_all&org=${org.slug}`}><Chip tone="steel">{orgName(org)}</Chip></Link>
        {season && <Chip>{season.name}</Chip>}
        {!org.enabled && <Chip>Inactive organization</Chip>}
      </p>
      {!org.enabled && <p className="panel info" role="status">{INACTIVE_ORG_NOTICE}</p>}
    </>
  );
}

type Tab = 'attendance' | 'categories' | 'brackets' | 'results' | 'stats';
const TABS: ReadonlyArray<readonly [Tab, string]> = [['attendance', 'Attendance'], ['categories', 'Categories'], ['brackets', 'Brackets'], ['results', 'Results'], ['stats', 'Statistics']];

/** The permanent record of a completed event. Everything comes from entries, matches and results the organizers recorded. */
export function EventHistory({ eventId, competitions, live }: { eventId: string; competitions: LiveCompetition[]; live: LiveState }) {
  const [tab, setTab] = useState<Tab>('results');
  const ids = competitions.map(c => c.id);
  const data = useAsync(() => fetchEventHistory(eventId, ids), [eventId, ids.join(',')]);
  const d = data.data;
  const totals = d ? attendanceTotals(d.entries, d.participants) : null;
  const allMatches = Object.values(live.data).flatMap(x => x.matches);
  const finalMatches = allMatches.filter(m => m.queueState === 'final').length;
  const nameOfTeam = (r: { teamId: string | null; entryId: string; teamNameAtEvent?: string | null }) => r.teamNameAtEvent ?? (r.teamId ? d?.teamNames.get(r.teamId) : undefined) ?? d?.entries.find(e => e.entryId === r.entryId)?.name ?? 'Unnamed entry';
  const testData = d?.synthetic === true;
  const table = d ? medalTable(d.results, nameOfTeam) : [];
  return (
    <section className="event-history" aria-labelledby="hist-h" style={{ display: 'grid', gap: 14 }}>
      <h2 id="hist-h">Event record</h2>
      <Tabs value={tab} options={TABS} onChange={setTab} />
      {data.loading && <p className="muted">Loading the record…</p>}
      {data.error != null && <p role="alert">{friendlyError(data.error, 'Could not load the event record.')}</p>}

      {d && tab === 'attendance' && (
        <div className="panel info">
          <h3>Attendance</h3>
          {d.entries.length === 0 ? <p className="muted">No entries are recorded for this event.</p> : (
            <>
              <p><b>{totals?.fighters ?? 0}</b> {totals?.fighters === 1 ? 'fighter' : 'different fighters'} took part, in <b>{plural(totals?.entries ?? 0, 'entry', 'entries')}</b>{(totals?.teams ?? 0) > 0 && <> from <b>{plural(totals?.teams ?? 0, 'team')}</b></>}.</p>
              {entriesByTeam(d.entries, d.teamNames).length > 0 && (
                <>
                  <p className="eyebrow">Entries by team</p>
                  <ul className="plain">{entriesByTeam(d.entries, d.teamNames).map(t => <li key={t.teamId} className="rowline"><span>{t.name}</span><span className="muted">{plural(t.entries, 'entry', 'entries')}</span></li>)}</ul>
                </>
              )}
              <p className="muted" style={{ fontSize: 13 }}>Group fights count each fighter on a team's roster. Withdrawn entries are not counted. A team's roster appears only where the organizer recorded one.</p>
            </>
          )}
        </div>
      )}

      {tab === 'categories' && (
        <div className="panel info">
          <h3>Categories that ran</h3>
          {competitions.length === 0 ? <p className="muted">No competitions were recorded for this event.</p> : (
            <ul className="plain">
              {competitions.map(c => {
                const n = d?.entries.filter(e => e.competitionId === c.id && e.status !== 'withdrawn').length;
                return (
                  <li key={c.id}><b>{c.name}</b> <Chip>{categoryLabel(c.category)}</Chip> <Chip>{divisionLabel(c.gender)}</Chip>
                    <div className="l">{c.ruleset ?? 'Ruleset not set'}{n !== undefined && ` · ${plural(n, 'entry', 'entries')}`}</div></li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'brackets' && (
        <>
          {live.loading && live.updatedAt === null && <p className="muted">Loading brackets…</p>}
          {live.error != null && live.updatedAt === null && <p role="alert">{friendlyError(live.error, 'Could not load the brackets.')}</p>}
          {live.updatedAt !== null && competitions.map(c => {
            const x = live.data[c.id];
            if (!x) return null;
            return (
              <div key={c.id} className="panel info live-comp">
                <h3>{c.name}</h3>
                {x.matches.length === 0 ? <p className="muted">No draw was recorded for this competition.</p> : (<><LivePools standings={x.standings} entries={x.entries} matches={x.matches} /><LiveBracket matches={x.matches} /></>)}
              </div>
            );
          })}
        </>
      )}

      {d && tab === 'results' && (
        <>
          {testData && <p className="panel info" role="note" data-testid="results-test-data"><TestBadge synthetic /> <b>Test data / synthetic event.</b> These placings are fictional. They are shown here because this is the event's own page; they are not official records and never count towards rankings, fighter or team statistics or event counts.</p>}
          {d.results.length === 0 && <div className="panel info"><h3>Results</h3><p className="muted">No final placings are recorded for this event yet. They appear when the organizer finishes a competition.</p></div>}
          {competitions.map(c => {
            const rows = d.results.filter(r => r.competitionId === c.id);
            if (rows.length === 0) return null;
            return (
              <div key={c.id} className="panel info">
                <h3>{c.name}</h3>
                <ol className="plain placelist">
                  {rows.map(r => (
                    <li key={r.entryId} className="rowline">
                      <span><span className={`medal ${medalOf(r.finalPlace) ?? ''}`}>{placeText(r.finalPlace)}</span> <b>{nameOfTeam(r)}</b></span>
                      <span className="muted">{r.points} points</span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </>
      )}

      {d && tab === 'stats' && (
        <div className="panel info">
          <h3>Event statistics</h3>
          <div className="statgrid">
            <div className="statcell"><b>{totals?.fighters ?? 0}</b><span>Different fighters</span></div>
            <div className="statcell"><b>{totals?.entries ?? 0}</b><span>Entries</span></div>
            <div className="statcell"><b>{finalMatches}</b><span>Matches played</span></div>
            <div className="statcell"><b>{competitions.length}</b><span>Categories</span></div>
          </div>
          {testData && <p role="note"><TestBadge synthetic /> <span className="muted">Fictional event: these figures are test data and count nowhere else.</span></p>}
          <p className="eyebrow">Medal table</p>
          {table.length === 0 ? <p className="muted">No medals are recorded for this event yet.</p> : (
            <ol className="plain">
              {table.map((t, i) => (
                <li key={t.key} className="rowline"><span><span className="rk">{i + 1}</span> <b>{t.name}</b></span><span className="muted">{t.golds} gold · {t.silvers} silver · {t.bronzes} bronze</span></li>
              ))}
            </ol>
          )}
          <p className="muted" style={{ fontSize: 13 }}>A shared third place gives a bronze to each. Matches played counts final matches with both sides set.</p>
        </div>
      )}
    </section>
  );
}
