import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar } from '../auth/account/shared';
import { Chip } from '../components/ui';
import { fetchFighterPhotos, photoUrl } from '../data/account';
import {
  fetchFighterAppearances, fetchFighterMemberships, fetchFighterRankings, fetchOrgLites, fetchRecentFights, fetchSeasons, type Appearance
} from '../data/careers';
import {
  fetchFighterCareerStats, fetchFighterHistory, fetchFighterMatchStats, fetchFighterProfile, fetchFighterSeasonStats, type FighterProfile
} from '../data/fighters';
import {
  categoryLabel, categoryLines, currentSeasonStats, divisionLabel, formatRecord, formString, genderLabel, guestLabel, INACTIVE_ORG_NOTICE, membershipSpan,
  orgName, outcomeLabel, placeText, plural, scoreText, sortFighterRankings, sortMemberships, sortFights, sumMatchStats, todayIso, tournamentHistory, winPctText
} from '../lib/careerView';
import { dateRange } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { roleLabel, safeHttpsUrl } from '../lib/teamDirectory';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const SOCIAL_NAME: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', discord: 'Discord', twitch: 'Twitch', other: 'Other link' };

/** One section that loads on its own. Errors stay inside the section; an empty section is hidden (the caller decides with `empty`). */
function Section<T>({ title, state, empty, children, note }: { title: string; state: AsyncState<T>; empty: (d: T) => boolean; children: (d: T) => ReactNode; note?: string }) {
  if (state.loading) return <div className="panel info"><h3>{title}</h3><p className="muted">Loading…</p></div>;
  if (state.error != null) return <div className="panel info"><h3>{title}</h3><p role="alert">{friendlyError(state.error, `Could not load ${title.toLowerCase()}.`)}</p></div>;
  if (state.data === undefined || empty(state.data)) return null;
  return <div className="panel info"><h3>{title}</h3>{children(state.data)}{note && <p className="muted" style={{ fontSize: 13 }}>{note}</p>}</div>;
}

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return <div className="statcell"><b>{value}</b><span>{label}</span></div>;
}

export function FighterPage() {
  const { id = '' } = useParams();
  const profile = useAsync(() => fetchFighterProfile(id), [id]);
  useDocumentTitle(profile.data?.displayName ?? 'Fighter');
  if (profile.loading) return <p className="muted">Loading fighter…</p>;
  if (profile.error != null) return <p role="alert">{friendlyError(profile.error, 'Could not load this fighter.')}</p>;
  if (!profile.data) {
    return (
      <section className="panel info"><h3>Fighter not found</h3>
        <p className="muted">This fighter does not exist, or the link is not right.</p>
        <Link className="btn btn-line btn-sm" to="/fighters">All fighters</Link></section>
    );
  }
  return <Career p={profile.data} />;
}

function Career({ p }: { p: FighterProfile }) {
  const id = p.fighterId;
  const career = useAsync(() => fetchFighterCareerStats(id), [id]);
  const matchStats = useAsync(() => fetchFighterMatchStats(id), [id]);
  const seasonStats = useAsync(() => fetchFighterSeasonStats(id), [id]);
  const history = useAsync(() => fetchFighterHistory(id), [id]);
  const rankings = useAsync(() => fetchFighterRankings(id), [id]);
  const fights = useAsync(() => fetchRecentFights(id, 10), [id]);
  const memberships = useAsync(() => fetchFighterMemberships(id), [id]);
  const appearances = useAsync(() => fetchFighterAppearances(id), [id]);
  const orgs = useAsync(fetchOrgLites, []);
  const seasons = useAsync(fetchSeasons, []);
  const photos = useAsync(() => (p.profilePublic || p.canEdit ? fetchFighterPhotos(id) : Promise.resolve([])), [id, p.profilePublic, p.canEdit]);
  const gallery = (photos.data ?? []).filter(x => x.path !== p.photoPath);
  const hidden = !p.profilePublic;
  const today = todayIso();
  const orgById = new Map((orgs.data ?? []).map(o => [o.id, o]));
  const seasonById = new Map((seasons.data ?? []).map(s => [s.id, s]));
  const where = [p.city, p.region, p.country].filter(Boolean).join(', ');
  const facts = [
    p.age !== null && `Age ${p.age}`, genderLabel(p.gender), p.joinedYear !== null && `Fighting since ${p.joinedYear}`,
    p.handedness && `${{ left: 'Left', right: 'Right', ambi: 'Either' }[p.handedness]}-handed`,
    p.heightCm !== null && `${p.heightCm} cm`, p.weightKg !== null && `${p.weightKg} kg`
  ].filter(Boolean) as string[];
  const socials = Object.entries(p.socialLinks).map(([k, v]) => ({ k, url: safeHttpsUrl(v) })).filter((x): x is { k: string; url: string } => x.url !== null);
  const hasStory = Boolean(p.fightingStyle || p.disciplines.length > 0 || p.bio || p.highlights.length > 0);
  const totals = sumMatchStats(matchStats.data ?? []);
  const places = history.data ?? [];

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <Link className="more" to="/fighters">← All fighters</Link>
      <div className="teamhead">
        {p.photoPath
          ? <Avatar path={p.photoPath} name={p.displayName} size={120} alt={`Photo of ${p.displayName}`} />
          : <span className="avatar" aria-hidden="true">{p.displayName.charAt(0).toUpperCase()}</span>}
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">Fighter{p.jerseyNumber !== null && ` · #${p.jerseyNumber}`}</p>
          <h1 style={{ fontSize: 'clamp(38px,6vw,72px)', marginTop: 8 }}>{p.displayName}</h1>
          {p.nickname && <p style={{ fontSize: 20, fontWeight: 600 }}>&ldquo;{p.nickname}&rdquo;{p.pronouns && <span className="muted" style={{ fontSize: 15 }}> · {p.pronouns}</span>}</p>}
          <div className="phead"><div className="sub">
            {p.team && <span>Home team: <Link to={`/teams/${p.team.slug}`}><b>{p.team.name}</b></Link></span>}
            {where && <span>{where}</span>}
            {facts.map(f => <span key={f}>{f}</span>)}
          </div></div>
          {p.organization && (
            <p style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip tone="steel">{p.organization.name}</Chip>{!p.organization.enabled && <Chip>Inactive organization</Chip>}
            </p>
          )}
        </div>
      </div>
      {p.organization && !p.organization.enabled && <p className="panel info" role="status">{INACTIVE_ORG_NOTICE}</p>}

      {p.canEdit && (
        <div className="acct-row">
          <Link className="btn btn-ink" to="/account">Edit my profile</Link>
          {hidden && <span className="muted">Your profile is private. Only you can see this page in full.</span>}
        </div>
      )}
      {hidden && !p.canEdit && <p className="panel info" role="status" style={{ padding: 14 }}>This fighter keeps their profile private. Only their name and team are shown.</p>}

      {(gallery.length > 0 || socials.length > 0) && (
        <div className="panel info">
          {gallery.length > 0 && (<><h3>Photos</h3><div className="pimg-row">{gallery.map(g => <img key={g.id} src={photoUrl(g.path) ?? ''} alt={g.caption ?? `Photo of ${p.displayName}`} loading="lazy" />)}</div></>)}
          {socials.length > 0 && <div className="teamlinks">{socials.map(x => <a key={x.k} className="btn btn-line btn-sm" href={x.url} target="_blank" rel="noopener noreferrer nofollow">{SOCIAL_NAME[x.k] ?? 'Link'}</a>)}</div>}
        </div>
      )}

      {hasStory && (
        <div className="panel info">
          <h3>About</h3>
          {p.fightingStyle && <p><b>Fighting style:</b> {p.fightingStyle}</p>}
          {p.disciplines.length > 0 && <p style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><b>Disciplines:</b> {p.disciplines.map(d => <Chip key={d} tone="steel">{categoryLabel(d)}</Chip>)}</p>}
          {p.bio && <p style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{p.bio}</p>}
          {p.highlights.length > 0 && (<><p className="eyebrow">Highlights</p><ul className="plain">{p.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul></>)}
          <p className="muted" style={{ fontSize: 13 }}>Written by the fighter, not checked by BuhurtOS.</p>
        </div>
      )}

      <Section title="Career" state={career} empty={c => c === null}>
        {c => !c ? null : c.eventsAttended === 0 && c.matches === 0 && c.podiums === 0
          ? <p className="muted">No competitions are recorded for this fighter yet. Their career fills in as organizers record results.</p>
          : (
            <>
              <div className="statgrid">
                <Tile label="Events attended" value={c.eventsAttended} />
                <Tile label="Matches" value={c.matches} />
                <Tile label="Wins" value={c.wins} />
                <Tile label="Losses" value={c.losses} />
                {c.draws > 0 && <Tile label="Draws" value={c.draws} />}
                <Tile label="Win rate" value={winPctText(c.winPct)} />
                <Tile label="Gold" value={c.golds} />
                <Tile label="Silver" value={c.silvers} />
                <Tile label="Bronze" value={c.bronzes} />
                <Tile label="Podiums" value={c.podiums} />
                <Tile label="Tournament wins" value={c.tournamentVictories} />
                <Tile label="League points" value={c.points} />
                {totals.matches > 0 && <Tile label="Rounds won / lost" value={`${totals.roundsWon} / ${totals.roundsLost}`} />}
                {totals.matches > 0 && <Tile label="Points for / against" value={`${totals.pointsFor} / ${totals.pointsAgainst}`} />}
              </div>
              <p className="muted" style={{ fontSize: 13 }}>Group fights count for every fighter on the roster. Points for and against are rounds won in group fights and strike points in duels.</p>
            </>
          )}
      </Section>

      <Section title="Rankings" state={rankings} empty={r => r.length === 0} note="Rank 1 is the most league points; equal points share a rank.">
        {rows => (
          <ul className="plain">
            {sortFighterRankings(rows).map((r, i) => {
              const org = r.organizationId ? orgById.get(r.organizationId) : undefined;
              const season = r.seasonId ? seasonById.get(r.seasonId) : undefined;
              const label = [org ? orgName(org) : 'All organizations', season?.name, r.category ? categoryLabel(r.category) : null, divisionLabel(r.gender) || null].filter(Boolean).join(' · ');
              return (
                <li key={i} className="rankline">
                  <span className="rk">#{r.rank}</span>
                  <span style={{ minWidth: 0 }}>{label}{org && !org.enabled && <> <Chip>Inactive</Chip></>}
                    <span className="l">{r.points} points · {plural(r.competitions, 'competition')}</span></span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="This season" state={seasonStats} empty={() => seasons.loading || (currentSeasonStats(seasonStats.data ?? [], seasons.data ?? [], today).rows.length === 0)}>
        {s => {
          const cur = currentSeasonStats(s, seasons.data ?? [], today);
          return (
            <>
              {!cur.current && <p className="muted">No season is running right now. This is the latest season with a record.</p>}
              <ul className="plain">
                {cur.rows.map(r => {
                  const org = r.organizationId ? orgById.get(r.organizationId) : undefined;
                  return (
                    <li key={`${r.seasonId}:${r.organizationId}`}>
                      <b>{r.season.name}</b>{org && <> <Chip tone="steel">{orgName(org)}</Chip></>}
                      <div className="l">{plural(r.eventsAttended, 'event')} · record {formatRecord(r.wins, r.losses, r.draws)} · {plural(r.podiums, 'podium')} ({r.golds} gold, {r.silvers} silver, {r.bronzes} bronze) · {r.points} points</div>
                    </li>
                  );
                })}
              </ul>
            </>
          );
        }}
      </Section>

      {(matchStats.data || history.data) && categoryLines(places, matchStats.data ?? []).length > 0 && (
        <div className="panel info">
          <h3>By category</h3>
          <ul className="plain">
            {categoryLines(places, matchStats.data ?? []).map(l => (
              <li key={l.key}>
                <b>{categoryLabel(l.category)}</b> <Chip>{divisionLabel(l.gender)}</Chip>
                <div className="l">
                  {l.matches > 0 ? `Record ${formatRecord(l.wins, l.losses, l.draws)}` : 'No matches recorded'}
                  {l.competitions > 0 && ` · ${plural(l.competitions, 'competition')}, best place ${placeText(l.bestPlace ?? 0)}`}
                  {l.golds + l.silvers + l.bronzes > 0 && ` · ${l.golds} gold, ${l.silvers} silver, ${l.bronzes} bronze`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Tournament history" state={history} empty={h => h.length === 0}>
        {h => (
          <ul className="plain">
            {tournamentHistory(h).map(t => (
              <li key={t.eventSlug}>
                <Link to={`/events/${t.eventSlug}`}><b>{t.eventName}</b></Link>
                <div className="l">{dateRange(t.startsOn, t.endsOn)}</div>
                <div className="placings">
                  {t.placements.map((pl, i) => (
                    <span key={i} className="placing">
                      {pl.medal ? <Chip tone={pl.medal === 'gold' ? 'brass' : pl.medal === 'silver' ? 'steel' : ''}>{placeText(pl.place)}</Chip> : <Chip>{placeText(pl.place)}</Chip>}
                      {' '}{pl.competition}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent fights" state={fights} empty={f => f.length === 0}>
        {f => {
          const sorted = sortFights(f);
          return (
            <>
              <div className="record" aria-label="Recent form, newest first">
                {formString(sorted).map((l, i) => <span key={i} className={`wl ${l === 'W' ? 'w' : l === 'L' ? 'l' : ''}`}>{l}</span>)}
              </div>
              <p className="muted" style={{ fontSize: 13 }}>Last {plural(sorted.length, 'fight')}, newest first.</p>
              <ul className="plain">
                {sorted.map(x => (
                  <li key={x.matchId} className="fightline">
                    <Chip tone={x.outcome === 'win' ? 'win' : ''}>{outcomeLabel(x.outcome)}</Chip>
                    <span style={{ minWidth: 0 }}>
                      <b>{x.opponent ? `Against ${x.opponent}` : 'Opponent not shown'}</b> <span className="muted">{scoreText(x.scoreFor, x.scoreAgainst)}</span>
                      <span className="l">{x.eventSlug ? <Link to={`/events/${x.eventSlug}`}>{x.eventName}</Link> : x.eventName} · {x.competition}{x.forTeam && ` · for ${x.forTeam}`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </Section>

      <Section title="Season by season" state={seasonStats} empty={s => s.length < 2 || seasons.loading}>
        {s => (
          <ul className="plain">
            {[...s].sort((a, b) => (seasonById.get(b.seasonId)?.endsOn ?? '').localeCompare(seasonById.get(a.seasonId)?.endsOn ?? '')).map(r => (
              <li key={`${r.seasonId}:${r.organizationId}`}><b>{seasonById.get(r.seasonId)?.name ?? 'Season'}</b>
                <div className="l">Record {formatRecord(r.wins, r.losses, r.draws)} · {plural(r.podiums, 'podium')} · {r.points} points</div></li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Upcoming" state={appearances} empty={a => upcoming(a, today).length === 0}>
        {a => (
          <ul className="plain">
            {upcoming(a, today).map(x => (
              <li key={x.entryId}>
                <Link to={`/events/${x.eventSlug}`}><b>{x.eventName}</b></Link>{' '}{x.eventStatus === 'draft' && <Chip tone="brass">Draft: only visible to organizers</Chip>}
                <div className="l">{dateRange(x.startsOn, x.endsOn)} · {x.competition}{x.forTeam && ` · ${x.role === 'mercenary' || x.role === 'guest' ? guestLabel(x.forTeam) : `for ${x.forTeam}`}`}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <TeamHistory memberships={memberships} appearances={appearances} homeTeam={p.team?.slug ?? null} />
    </section>
  );
}

const upcoming = (a: Appearance[], today: string): Appearance[] =>
  a.filter(x => x.endsOn >= today && x.eventStatus !== 'cancelled').sort((x, y) => x.startsOn.localeCompare(y.startsOn));

function TeamHistory({ memberships, appearances, homeTeam }: { memberships: AsyncState<Awaited<ReturnType<typeof fetchFighterMemberships>>>; appearances: AsyncState<Appearance[]>; homeTeam: string | null }) {
  const guests = (appearances.data ?? []).filter(a => (a.role === 'mercenary' || a.role === 'guest') && a.forTeam).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  const rows = sortMemberships(memberships.data ?? []);
  if (memberships.loading) return <div className="panel info"><h3>Team history</h3><p className="muted">Loading…</p></div>;
  if (memberships.error != null) return <div className="panel info"><h3>Team history</h3><p role="alert">{friendlyError(memberships.error, 'Could not load team history.')}</p></div>;
  if (rows.length === 0 && guests.length === 0) return null;
  return (
    <div className="panel info">
      <h3>Team history</h3>
      <ul className="plain">
        {rows.map(m => (
          <li key={m.id}>
            <Link to={`/teams/${m.teamSlug}`}><b>{m.mercenary ? guestLabel(m.teamName) : m.teamName}</b></Link>{' '}
            {m.teamSlug === homeTeam && !m.mercenary && <Chip tone="brass">Home team</Chip>} {m.role !== 'fighter' && <Chip>{roleLabel(m.role)}</Chip>}
            {membershipSpan(m) && <div className="l">{membershipSpan(m)}</div>}
          </li>
        ))}
        {guests.map(g => (
          <li key={`g:${g.entryId}`}>
            <b>{guestLabel(g.forTeam as string)}</b>
            <div className="l"><Link to={`/events/${g.eventSlug}`}>{g.eventName}</Link> · {dateRange(g.startsOn, g.endsOn)}</div>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ fontSize: 13 }}>Fighting as a guest never changes a fighter's home team.</p>
    </div>
  );
}
