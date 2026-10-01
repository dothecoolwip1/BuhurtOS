import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Bracket } from '../components/Bracket';
import { Crest } from '../components/Crest';
import { LeagueIcon } from '../components/LeagueIcon';
import { ProCard } from '../components/ProCard';
import { Sparks } from '../components/Sparks';
import { Standings } from '../components/Standings';
import { TeamCard } from '../components/TeamCard';
import { Chip, Seg, Tabs, TierChip } from '../components/ui';
import { BRACKET_M5, COMPETITIONS, DUELISTS, EVENTS, FEATURED_EVENT, FIELDS, POOL_A, POOL_B, RR_W5, SAS_ROUND_ROBIN, SCHEDULE, TEAM_LIST, TEAMS } from '../data/fixtures';
import { LEAGUE_NAME } from '../data/types';
import type { FieldQueue } from '../data/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { EventRow } from '../components/EventRow';
import { NotFoundPage } from './NotFoundPage';

type Tab = 'live' | 'competitions' | 'bracket' | 'schedule' | 'entrants' | 'info';
const TABS: readonly (readonly [Tab, string])[] = [['live', 'Live'], ['competitions', 'Competitions'], ['bracket', 'Bracket'], ['schedule', 'Schedule'], ['entrants', 'Entrants'], ['info', 'Info']];

function Field({ f }: { f: FieldQueue }) {
  return (
    <div className="panel field">
      <div className="fh"><h3>{f.name}</h3><Chip tone="live">Running</Chip></div>
      {f.slots.map(s => (
        <div key={s.label} className={`slot ${s.kind === 'now' ? 'now' : ''}`}>
          <span className="k">{s.label}</span>
          <div style={{ minWidth: 0 }}>
            {s.teamA && s.teamB ? (
              <><div className="t"><Crest team={TEAMS[s.teamA]} size={22} />{TEAMS[s.teamA].name}<i>v</i><Crest team={TEAMS[s.teamB]} size={22} />{TEAMS[s.teamB].name}</div><div className="src">{s.sub}</div></>
            ) : <div className="t">{s.sub}</div>}
          </div>
          <span className="sc">{s.score ?? ''}</span>
        </div>
      ))}
    </div>
  );
}

function CompetitionBody({ id }: { id: string }) {
  const c = COMPETITIONS.find(x => x.id === id) ?? COMPETITIONS[0];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <span className="lgdot"><LeagueIcon id={c.league} size={18} /> {LEAGUE_NAME[c.league]}</span><TierChip tier={c.tier} /><Chip>{c.division}</Chip><Chip>{c.entrants}</Chip><span className="src">{c.structure}</span>
      </div>
      {c.id === 'm5' && <Bracket rounds={BRACKET_M5} />}
      {c.id === 'w5' && (<><Standings title="Round robin" rows={RR_W5} metricLabel="Round diff" /><p className="src" style={{ marginTop: 12 }}>If two teams were tied, step 1 of the tie rules (head-to-head) would decide.</p></>)}
      {c.id === 'lsw' && (<>
        <div className="two"><Standings title="Pool A" rows={POOL_A} metricLabel="Hits ratio" /><Standings title="Pool B" rows={POOL_B} metricLabel="Hits ratio" /></div>
        <div className="panel info" style={{ marginTop: 16 }}><h3>Semifinals</h3><p style={{ color: 'var(--muted)' }}>Top two from each pool advance: <b>Kessling v Achterberg</b> and <b>MacRae v Holloway</b>. Pool B has a 3–1 tie decided by step 2: hits earned against hits received (1.8 against 1.5).</p></div>
      </>)}
      {c.id === 'sas' && <Standings title="Round robin" rows={SAS_ROUND_ROBIN} metricLabel="Hits ratio" />}
      {c.id === 'pf' && <ProCard />}
    </>
  );
}

function Hub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = TABS.some(([k]) => k === raw) ? (raw as Tab) : 'live';
  const comp = COMPETITIONS.some(c => c.id === params.get('comp')) ? params.get('comp')! : 'm5';
  const go = (t: Tab, c?: string) => { const p: Record<string, string> = { tab: t }; if (t === 'bracket') p.comp = c ?? comp; setParams(p, { replace: true }); };
  useDocumentTitle(FEATURED_EVENT.name);
  return (
    <>
      <section className="ehero fade-in"><Sparks />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Chip tone="live">Live now</Chip><Chip>Classic tier</Chip><Chip>5 competitions</Chip><Chip>Hosted by Iron Wardens</Chip></div>
        <h1>{FEATURED_EVENT.name}</h1>
        <div className="facts"><span><small>When</small>{FEATURED_EVENT.dates}</span><span><small>Where</small>{FEATURED_EVENT.venue}</span><span><small>Formats</small>Group fight · Duels · Profight</span></div>
        <div className="acts"><Link className="btn btn-ghost" to="/rules">Look up a rule</Link><Link className="btn btn-ghost" to="/marshal">Marshal scoring</Link></div>
      </section>
      <div style={{ marginTop: 20 }}><Tabs value={tab} options={TABS} onChange={t => go(t)} /></div>
      <div className="fade-in" style={{ marginTop: 22 }} key={tab}>
        {tab === 'live' && (<>
          <div className="fields">{FIELDS.map(f => <Field key={f.name} f={f} />)}</div>
          <div className="stat-strip" style={{ marginTop: 20 }}><div><b className="mono">23</b><span>fights finished</span></div><div><b className="mono">19</b><span>to fight</span></div><div><b className="mono">2</b><span>fields running</span></div><div><b className="mono">~4:40</b><span>expected finish</span></div></div>
        </>)}
        {tab === 'competitions' && (
          <div style={{ display: 'grid', gap: 12 }}>
            {COMPETITIONS.map(c => (
              <button key={c.id} type="button" className="panel compcard" onClick={() => go('bracket', c.id)}>
                <span className="ic"><LeagueIcon id={c.league} size={24} /></span>
                <div style={{ minWidth: 0 }}><h3>{c.name}</h3><div className="m"><span>{LEAGUE_NAME[c.league]}</span><span>{c.tier}</span><span>{c.division}</span><span>{c.entrants}</span></div><div className="m"><span>{c.structure}</span></div></div>
                <Chip tone={c.status.tone}>{c.status.label}</Chip>
              </button>
            ))}
            <p className="src">An event holds many competitions. Each one has its own tier, division, structure and ranking, so a single weekend can award points for several categories.</p>
          </div>
        )}
        {tab === 'bracket' && (<>
          <div style={{ marginBottom: 18 }}><Seg label="Competition" value={comp} options={COMPETITIONS.map(c => [c.id, c.name] as const)} onChange={c => go('bracket', c)} /></div>
          <CompetitionBody id={comp} />
        </>)}
        {tab === 'schedule' && (
          <div className="grid-2">{SCHEDULE.map(d => (
            <div className="panel info" key={d.day}><h3>{d.day}</h3>
              <div className="timeline">{d.items.map(i => (
                <div className="tl" key={i.time + i.title}><span className="h mono">{i.time}</span><span className={`d ${i.state}`} /><div><b>{i.title}</b><p>{i.text}</p></div></div>
              ))}</div>
            </div>
          ))}</div>
        )}
        {tab === 'entrants' && (
          <div style={{ display: 'grid', gap: 22 }}>
            <div><h2 style={{ fontSize: 30, marginBottom: 14 }}>Teams</h2><div className="teamgrid">{TEAM_LIST.map(t => <TeamCard key={t.id} team={t} />)}</div></div>
            <div><h2 style={{ fontSize: 30, marginBottom: 14 }}>Duellists</h2><div className="roster">{DUELISTS.map(d => (
              <div className="person" key={d.name}><span className="av">{d.name.split(' ').map(x => x[0]).join('')}</span><span><b>{d.name}</b><small>{d.club}</small></span></div>
            ))}</div></div>
          </div>
        )}
        {tab === 'info' && (
          <div className="grid-2">
            <div className="panel info"><h3>About this event</h3><p style={{ color: 'var(--muted)' }}>A two-day open with group fights, three duel categories and a profight card. Spectators welcome; bring a chair. Food trucks on site.</p>
              <dl className="dl"><div><dt>Tier</dt><dd>Classic (sample)</dd></div><div><dt>Registration</dt><dd>Closed · 13 teams, 15 duellists</dd></div><div><dt>Rules</dt><dd>Buhurt Rules V.26.4.1 · Duels V.26.4 · Outrance V.26.4</dd></div><div><dt>Host</dt><dd>Iron Wardens</dd></div><div><dt>Spectators</dt><dd>Free</dd></div></dl></div>
            <div className="panel info"><h3>What a Classic tier needs</h3><dl className="dl"><div><dt>Marshals</dt><dd>1 Conference-accredited</dd></div><div><dt>Submitted to BI</dt><dd>45 days ahead</dd></div><div><dt>Streaming</dt><dd>Video recording</dd></div></dl><p className="src">From League Structure V2026.1 §2.3.3. This event is sample data.</p></div>
          </div>
        )}
      </div>
    </>
  );
}

export function EventPage() {
  const { eventId } = useParams();
  const e = EVENTS.find(x => x.id === eventId);
  useDocumentTitle(e?.name ?? 'Event');
  if (!e) return <NotFoundPage />;
  if (e.hasHub) return <Hub />;
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <Link className="more" to="/events">← All events</Link>
      <EventRow e={e} />
      <div className="panel info"><h3>Full event page coming</h3><p style={{ color: 'var(--muted)' }}>In this preview only the Prairie Steel Open has the full event hub with live fields, competitions and brackets. <Link className="more" to="/events/prairie-steel-open">Open it →</Link></p></div>
    </section>
  );
}
