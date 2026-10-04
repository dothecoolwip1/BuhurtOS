import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Seg } from '../components/ui';
import { fetchDisciplineContributions, fetchTeamDisciplineBoard, fetchTeamDisciplineLeaders, type DisciplineFilter, type RankingScope, type TeamDisciplineRow } from '../data/fighters';
import { plural } from '../lib/careerView';
import { friendlyError } from '../lib/friendlyError';
import {
  boardTitle, contributionLines, contributionTotal, disciplineBoard, disciplineOverview, disciplineParams, disciplineScope, divisionOptions, divisionSplit, formatPoints,
  genderOf, resolveDiscipline, resolveDivision, splitText, type DisciplineCard, type DivisionChoice
} from '../lib/teamDisciplineRankings';
import { useAsync } from '../lib/useAsync';

/**
 * Rankings > Teams > Discipline totals. Each team's total in a discipline is the individual ranking points of the fighters who represented it,
 * added up (computed by the database view ranking_team_disciplines). Separate from the team fights ranking on purpose.
 */
export function TeamDisciplineTotals({ scope, organizationId, seasonId, params, setParams }: {
  scope: RankingScope; organizationId: string; seasonId: string; params: URLSearchParams; setParams: (p: URLSearchParams) => void;
}) {
  const dScope = disciplineScope(scope);
  const filter: DisciplineFilter = { scope: dScope, organizationId: dScope === 'career' ? null : organizationId, seasonId: dScope === 'season' ? seasonId : null };
  const ready = dScope === 'career' || (!!organizationId && (dScope !== 'season' || !!seasonId));
  const key = JSON.stringify(filter);
  const leaders = useAsync(() => (ready ? fetchTeamDisciplineLeaders(filter) : Promise.resolve([])), [ready, key]);
  const cards = useMemo(() => disciplineOverview(leaders.data ?? []), [leaders.data]);
  const card = resolveDiscipline(cards, params.get('discipline'));
  const division = resolveDivision(card, params.get('division'));
  const board = useAsync(() => (card ? fetchTeamDisciplineBoard({ ...filter, category: card.category }) : Promise.resolve([])), [key, card?.category]);
  const unattributed = useAsync(() => (card ? fetchDisciplineContributions({ ...filter, category: card.category, gender: genderOf(division), teamId: null }) : Promise.resolve([])), [key, card?.category, division]);
  const rows = useMemo(() => disciplineBoard(board.data ?? [], division), [board.data, division]);

  const open = (c: DisciplineCard) => {
    setParams(disciplineParams(c.category, params));
    document.getElementById('discipline-board-h')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const setDivision = (d: DivisionChoice) => { const next = new URLSearchParams(params); next.set('division', d); setParams(next); };
  const where = dScope === 'season' ? 'this season' : dScope === 'org_career' ? 'this organization' : 'any organization';

  if (!ready) return null;
  return (
    <>
      <p className="muted" style={{ fontSize: 14 }}>
        A team's total in a discipline is the individual ranking points its fighters earned in it, added up and credited to the team each fighter
        fought for at the time. Group fights are ranked separately, under Team fights.
      </p>
      {leaders.loading && <p className="muted">Loading team totals…</p>}
      {leaders.error != null && <p role="alert">{friendlyError(leaders.error, 'Could not load the team totals.')}</p>}
      {!leaders.loading && leaders.error == null && cards.length === 0 && (
        <div className="panel info"><h3>No team totals yet</h3>
          <p className="muted">No individual result in {where} is credited to a team yet. Disciplines appear here as soon as fighters earn points for their teams.</p></div>
      )}
      {cards.length > 0 && (
        <section aria-labelledby="discipline-leaders-h" style={{ display: 'grid', gap: 10 }}>
          <h2 id="discipline-leaders-h" style={{ fontSize: 22 }}>Team discipline leaders</h2>
          {scope === 'org_all' && <p className="muted" style={{ fontSize: 14 }}>Over the organization's whole history. Tap a discipline for its full team table.</p>}
          <ul className="topteams">
            {cards.map(c => (
              <li key={c.category}>
                <button type="button" className="panel topteam" aria-current={c.category === card?.category ? 'true' : undefined} onClick={() => open(c)}
                  aria-label={`${c.label}: ${c.leaders.map(l => l.teamName).join(' and ')}, ${formatPoints(c.points)} points. Open the full team table.`}>
                  <span className="eyebrow">{c.label}</span>
                  <span className="n">#1 {c.leaders[0].teamName}</span>
                  {c.leaders.length > 1 && <span className="l">Tied with {c.leaders.slice(1).map(l => l.teamName).join(', ')}</span>}
                  <span className="pts"><b>{formatPoints(c.points)}</b> points</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {card && (
        <section aria-labelledby="discipline-board-h" style={{ display: 'grid', gap: 10, scrollMarginTop: 72 }}>
          <h2 id="discipline-board-h" style={{ fontSize: 22 }}>{boardTitle(card, division)}: team totals</h2>
          {divisionOptions(card).length > 0 && <Seg label="Division" value={division} options={divisionOptions(card)} onChange={setDivision} />}
          {board.loading && <p className="muted">Loading the table…</p>}
          {board.error != null && <p role="alert">{friendlyError(board.error, 'Could not load the team table.')}</p>}
          <ol className="rankcards">
            {rows.map(r => <DisciplineTeamCard key={r.teamId} r={r} split={division === 'all' ? splitText(divisionSplit(board.data ?? [], r.teamId)) : ''} filter={filter} category={card.category} division={division} />)}
          </ol>
          {(unattributed.data?.length ?? 0) > 0 && (
            <p className="muted" style={{ fontSize: 14 }}>
              Not credited to any team: {formatPoints(contributionTotal(unattributed.data ?? []))} points from {plural(unattributed.data!.length, 'fighter')} whose
              team at the time was not recorded ({contributionLines(unattributed.data ?? []).map(c => c.displayName).join(', ')}). BuhurtOS does not guess past teams.
            </p>
          )}
        </section>
      )}
    </>
  );
}

/** One team's line. "Show fighters" lists who earned the total, so it can be checked. */
function DisciplineTeamCard({ r, split, filter, category, division }: { r: TeamDisciplineRow; split: string; filter: DisciplineFilter; category: string; division: DivisionChoice }) {
  const [openList, setOpenList] = useState(false);
  const lines = useAsync(() => (openList ? fetchDisciplineContributions({ ...filter, category, gender: genderOf(division), teamId: r.teamId }) : Promise.resolve(undefined)),
    [openList, JSON.stringify(filter), category, division, r.teamId]);
  const listId = `contrib-${r.teamId}`;
  return (
    <li className="panel rankcard" style={{ gridTemplateRows: 'auto auto' }}>
      <span className="rk" aria-label={`Rank ${r.rank}`}>{r.rank}</span>
      <span style={{ minWidth: 0 }}>
        <Link to={`/teams/${r.teamSlug}`} className="n">{r.teamName}</Link>
        <span className="l">{plural(r.fighters, 'fighter')} · {plural(r.results, 'result')}{split ? ` · ${split}` : ''}</span>
        <button type="button" className="btn btn-line rk-more" aria-expanded={openList} aria-controls={listId} onClick={() => setOpenList(o => !o)}>{openList ? 'Hide fighters' : 'Show fighters'}</button>
      </span>
      <span className="pts"><b>{formatPoints(r.points)}</b><span>points</span></span>
      {openList && (
        <div id={listId} style={{ gridColumn: '1 / -1' }}>
          {lines.loading && <p className="muted">Loading…</p>}
          {lines.error != null && <p role="alert">{friendlyError(lines.error, 'Could not load the fighters.')}</p>}
          {lines.data && (
            <ul className="contriblist" aria-label={`Fighters behind ${r.teamName}'s ${formatPoints(r.points)} points`}>
              {contributionLines(lines.data).map(c => (
                <li key={c.fighterId}><Link to={`/fighters/${c.fighterId}`}>{c.displayName}</Link><b>{formatPoints(c.points)}</b></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
