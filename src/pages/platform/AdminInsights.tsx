import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip, PageHead, Seg } from '../../components/ui';
import {
  durationText, featureUsage, fetchActivity, fetchAnalytics, fetchBugReports, fetchPeopleUsage, fetchVisitPages, minutesBetween, pageLabel, screenshotUrl, secondsText,
  setBugStatus, summarizeActivity, zoneLabel, type Audience, type BugReport, type BugStatus, type Count, type Device, type Visit
} from '../../data/admin';
import { friendlyError } from '../../lib/friendlyError';
import { timeAgo } from '../../lib/notificationView';
import { useAsync } from '../../lib/useAsync';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PlatformGate } from './PlatformPages';

const bad: React.CSSProperties = { color: 'var(--live)' };
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const who = (v: Pick<Visit, 'name' | 'email' | 'userId'>) => (v.userId ? v.name || v.email || 'Signed-in person' : 'Visitor (not signed in)');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const RANGES = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['custom', 'Custom']] as const;
type Range = (typeof RANGES)[number][0];
const AUDIENCES = [['all', 'Everyone'], ['anonymous', 'Not signed in'], ['registered', 'Signed in']] as const;
const TABS = [['overview', 'Overview'], ['live', 'Live'], ['people', 'People']] as const;
type Tab = (typeof TABS)[number][0];
const EVENT_LABEL: Record<string, string> = {
  sign_in_opened: 'Opened sign-in', sign_in_code_sent: 'Asked for a sign-in code', sign_up: 'Created an account', login: 'Signed in', profile_completed: 'Finished profile setup',
  profile_updated: 'Changed profile details', search: 'Searched', registration_submitted: 'Registered for an event', event_created: 'Created an event', team_requested: 'Asked for a new team',
  team_join_requested: 'Asked to join a team', bug_reported: 'Reported a bug', client_error: 'Hit an error in the app'
};
const eventLabel = (n: string) => EVENT_LABEL[n.split(' ')[0]] ?? n;

/** [from, to) for the chosen range. "Today" starts at local midnight; a custom range includes its last day. */
export function rangeBounds(r: Range, customFrom: string, customTo: string, now = new Date()): { from: Date; to: Date } {
  const to = new Date(now.getTime() + 60_000);
  if (r === 'today') { const f = new Date(now); f.setHours(0, 0, 0, 0); return { from: f, to }; }
  if (r === 'custom') {
    const f = new Date(`${customFrom}T00:00:00`); const t = new Date(`${customTo}T00:00:00`); t.setDate(t.getDate() + 1);
    return Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t <= f ? { from: new Date(now.getTime() - 86_400_000), to } : { from: f, to: t };
  }
  return { from: new Date(now.getTime() - Number(r) * 86_400_000), to };
}

/** Owner only: website and product analytics. The database refuses every other account (admin_* functions check private.is_owner()). */
export function PlatformActivityPage() {
  useDocumentTitle('Analytics · Platform');
  return <PlatformGate><Analytics /></PlatformGate>;
}

function Bars({ title, rows, label = (s: string) => s, empty = 'Nothing yet.', unit = '' }: { title: string; rows: readonly Count[]; label?: (s: string) => string; empty?: string; unit?: string }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <section className="panel an-card" aria-label={title}>
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="muted">{empty}</p> : (
        <ol className="bars">
          {rows.map(r => (
            <li key={r.name}><span className="bar-name" title={r.name}>{label(r.name)}</span><span className="bar-n">{r.n}{unit}</span><span className="bar" style={{ width: `${(r.n / max) * 100}%` }} /></li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Funnel({ title, steps }: { title: string; steps: [string, number][] }) {
  const top = Math.max(1, steps[0]?.[1] ?? 1);
  return (
    <section className="panel an-card" aria-label={title}>
      <h3>{title}</h3>
      <ol className="bars">
        {steps.map(([name, n], i) => (
          <li key={name}><span className="bar-name">{name}</span><span className="bar-n">{n}{i > 0 && steps[0][1] > 0 ? ` · ${Math.round((n / top) * 100)}%` : ''}</span><span className="bar" style={{ width: `${(n / top) * 100}%` }} /></li>
        ))}
      </ol>
    </section>
  );
}

function Analytics() {
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<Range>('7');
  const [customFrom, setCustomFrom] = useState(() => ymd(new Date(Date.now() - 13 * 86_400_000)));
  const [customTo, setCustomTo] = useState(() => ymd(new Date()));
  const [audience, setAudience] = useState<Audience>('all');
  const [device, setDevice] = useState<Device | ''>('');
  const [pageFilter, setPageFilter] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setTick(x => x + 1), 60_000); return () => window.clearInterval(t); }, []);
  const { from, to } = useMemo(() => rangeBounds(range, customFrom, customTo), [range, customFrom, customTo, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = useAsync(() => (tab === 'overview' ? fetchAnalytics(from, to, audience, device || null) : Promise.resolve(null)), [tab, from.getTime(), to.getTime(), audience, device]);
  const a = data.data;
  const posthog = import.meta.env.VITE_POSTHOG_KEY ? ((import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com').replace('.i.posthog.com', '.posthog.com') : null;

  const pf = pageFilter.trim().toLowerCase();
  const matches = (path: string) => !pf || path.toLowerCase().includes(pf) || pageLabel(path).toLowerCase().includes(pf);
  const pages = (a?.pages ?? []).filter(p => matches(p.path));

  return (
    <section className="plat fade-in" style={{ display: 'grid', gap: 18 }}>
      <p><Link className="more" to="/platform">← Platform</Link></p>
      <PageHead eyebrow="Platform · super admin only" title="Analytics" lede="Who visits BuhurtOS, how long they stay and what they use. Only you can see this page; the database refuses everyone else." />
      <Seg label="View" value={tab} options={TABS} onChange={setTab} />

      {tab === 'overview' && <>
        <div className="an-filters">
          <Seg scroll label="Time range" value={range} options={RANGES} onChange={setRange} />
          {range === 'custom' && (
            <div className="an-dates">
              <label className="field-in">From<input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} /></label>
              <label className="field-in">To<input type="date" value={customTo} min={customFrom} onChange={e => setCustomTo(e.target.value)} /></label>
            </div>
          )}
          <Seg scroll label="Who" value={audience} options={AUDIENCES} onChange={setAudience} />
          <div className="an-dates">
            <label className="field-in">Device
              <select value={device} onChange={e => setDevice(e.target.value as Device | '')}><option value="">All devices</option><option value="phone">Phones</option><option value="tablet">Tablets</option><option value="desktop">Computers</option></select>
            </label>
            <label className="field-in">Page or feature<input type="search" value={pageFilter} placeholder="For example teams or register" onChange={e => setPageFilter(e.target.value)} /></label>
          </div>
        </div>
        {data.error != null && <p role="alert" style={bad}>{friendlyError(data.error, 'Could not load analytics. If this is new, the database update may not be applied yet.')}</p>}
        {data.loading && !a && <p className="muted">Loading…</p>}
        {a && <>
          <div className="statgrid">
            <div className="statcell"><b>{a.totals.onlineNow}</b><span>On right now</span></div>
            <div className="statcell"><b>{a.totals.visitors}</b><span>Visitors</span></div>
            <div className="statcell"><b>{a.totals.newVisitors}</b><span>New visitors</span></div>
            <div className="statcell"><b>{a.totals.returningVisitors}</b><span>Returning visitors</span></div>
            <div className="statcell"><b>{a.totals.sessions}</b><span>Visits</span></div>
            <div className="statcell"><b>{a.totals.anonymousSessions}</b><span>Visits not signed in</span></div>
            <div className="statcell"><b>{a.totals.registeredPeople}</b><span>Signed-in people</span></div>
            <div className="statcell"><b>{secondsText(a.totals.avgSessionSeconds)}</b><span>Average visit</span></div>
            <div className="statcell"><b>{a.totals.pageViews}</b><span>Pages opened</span></div>
            <div className="statcell"><b>{a.totals.signups}</b><span>New accounts</span></div>
            <div className="statcell"><b>{a.totals.logins}</b><span>Sign-ins</span></div>
            <div className="statcell"><b>{a.totals.accountsTotal}</b><span>Accounts in total</span></div>
          </div>

          {a.daily.length > 1 && <Bars title="Visits per day" rows={a.daily.map(d => ({ name: d.day, n: d.sessions }))} label={d => day(`${d}T12:00:00`)} />}

          <div className="an-grid">
            <section className="panel an-card an-wide" aria-label="Pages">
              <h3>Pages{pf ? ` matching “${pageFilter.trim()}”` : ''}</h3>
              {pages.length === 0 ? <p className="muted">Nothing yet.</p> : (
                <div className="an-table" role="table">
                  <div role="row" className="an-th"><span role="columnheader">Page</span><span role="columnheader">Opened</span><span role="columnheader">Visits</span><span role="columnheader">Avg time</span></div>
                  {pages.map(p => (
                    <div role="row" key={p.path}><span role="cell"><b>{pageLabel(p.path)}</b><small className="src">{p.path}</small></span><span role="cell">{p.views}</span><span role="cell">{p.visits}</span><span role="cell">{secondsText(p.avgSeconds)}</span></div>
                  ))}
                </div>
              )}
            </section>
            <Bars title="Parts of the site used (pages opened)" rows={featureUsage(pages)} />
            <Bars title="Where visits start" rows={a.entryPages.filter(r => matches(r.name))} label={pageLabel} />
            <Bars title="Where visits end" rows={a.exitPages.filter(r => matches(r.name))} label={pageLabel} />
            <Bars title="Most common next page" rows={a.paths.filter(p => matches(p.from) || matches(p.to)).map(p => ({ name: `${pageLabel(p.from)} → ${pageLabel(p.to)}`, n: p.n }))} />
            <Funnel title="Sign-up funnel (visits)" steps={[['Opened sign-in', a.funnelSignup.signInOpened], ['Asked for a code', a.funnelSignup.codeRequested], ['Created an account', a.funnelSignup.signedUp], ['Finished profile', a.funnelSignup.profileCompleted]]} />
            <Funnel title="Registration funnel (visits)" steps={[['Opened an event', a.funnelRegistration.eventPageViews], ['Opened the form', a.funnelRegistration.registerPageViews], ['Sent a registration', a.funnelRegistration.registrationsSubmitted]]} />
            <Bars title="Pages where accounts were created" rows={a.signupEntryPages} label={pageLabel} empty="No new accounts in this time." />
            <Bars title="Actions" rows={a.events.map(e => ({ name: e.name, n: e.n }))} label={eventLabel} />
            <Bars title="Searches" rows={a.searches} empty="No searches yet." />
            <Bars title="Came from" rows={a.referrers} label={s => (s === 'direct' ? 'Typed or bookmarked' : s)} />
            {a.utmSources.length > 0 && <Bars title="Campaign links (utm_source)" rows={a.utmSources} />}
            <Bars title="Devices" rows={a.devices} label={s => ({ phone: 'Phone', tablet: 'Tablet', desktop: 'Computer' } as Record<string, string>)[s] ?? 'Unknown'} />
            <Bars title="Browsers" rows={a.browsers} />
            <Bars title="Systems" rows={a.os} />
            <Bars title="Approximate region (from time zone)" rows={a.timeZones} label={zoneLabel} />
          </div>
          {a.events.some(e => e.name === 'client_error') && <p className="src">“Hit an error in the app” counts errors the browser reported. Details are in your bug reports when people send them.</p>}
        </>}
      </>}

      {tab === 'live' && <Live />}
      {tab === 'people' && <People from={from} to={to} />}

      <p className="src">
        Only page addresses (never what people type, never query strings), device type, browser and system family, time zone and referring site are kept. Never GPS.
        Visits older than 90 days are deleted.{posthog ? <> Country, region and city (from IP, approximate) are in <a href={posthog} target="_blank" rel="noopener noreferrer">PostHog</a>.</> : ' Country, region and city from IP need PostHog (not set up yet).'}
      </p>
    </section>
  );
}

const LIVE_RANGES = [['1', 'Last hour'], ['24', '24 hours'], ['168', '7 days']] as const;
function Live() {
  const [hours, setHours] = useState<(typeof LIVE_RANGES)[number][0]>('24');
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setTick(x => x + 1), 30_000); return () => window.clearInterval(t); }, []);
  const visits = useAsync(() => fetchActivity(Number(hours)), [hours, tick]);
  const list = visits.data ?? [];
  const sum = useMemo(() => summarizeActivity(list), [list]);
  const online = list.filter(v => v.online);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Seg scroll label="Time range" value={hours} options={LIVE_RANGES} onChange={setHours} />
      {visits.error != null && <p role="alert" style={bad}>{friendlyError(visits.error, 'Could not load activity.')}</p>}
      <div className="statgrid">
        <div className="statcell"><b>{sum.onlineNow}</b><span>On right now</span></div>
        <div className="statcell"><b>{sum.visits}</b><span>Visits</span></div>
        <div className="statcell"><b>{sum.people}</b><span>Signed-in people</span></div>
        <div className="statcell"><b>{durationText(sum.avgMinutes || 1)}</b><span>Average visit</span></div>
      </div>
      <section aria-labelledby="online-h" style={{ display: 'grid', gap: 10 }}>
        <h2 id="online-h" className="acct-h">On right now ({online.length})</h2>
        {online.length === 0 && !visits.loading && <p className="muted">Nobody in the last 2 minutes.</p>}
        <div className="panel acct-list">{online.map(v => <VisitRow key={v.sessionId} v={v} open={open === v.sessionId} onToggle={() => setOpen(open === v.sessionId ? null : v.sessionId)} />)}</div>
      </section>
      <section aria-labelledby="visits-h" style={{ display: 'grid', gap: 10 }}>
        <h2 id="visits-h" className="acct-h">Recent visits ({list.length}{list.length >= 500 ? ', newest 500' : ''})</h2>
        {visits.loading && !visits.data && <p className="muted">Loading…</p>}
        {!visits.loading && list.length === 0 && <p className="muted">No visits in this time.</p>}
        <div className="panel acct-list">{list.filter(v => !v.online).map(v => <VisitRow key={v.sessionId} v={v} open={open === v.sessionId} onToggle={() => setOpen(open === v.sessionId ? null : v.sessionId)} />)}</div>
      </section>
    </>
  );
}

function People({ from, to }: { from: Date; to: Date }) {
  const people = useAsync(() => fetchPeopleUsage(from, to), [from.getTime(), to.getTime()]);
  const [q, setQ] = useState('');
  const list = (people.data ?? []).filter(p => !q.trim() || `${p.name ?? ''} ${p.email ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <p className="muted">Signed-in accounts that used the site in the chosen time range (set it on Overview). Product use only: pages and actions, never what they typed.</p>
      <label className="field-in">Find a person<input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or email" /></label>
      {people.error != null && <p role="alert" style={bad}>{friendlyError(people.error, 'Could not load people.')}</p>}
      {people.loading && !people.data && <p className="muted">Loading…</p>}
      {!people.loading && list.length === 0 && <p className="muted">Nobody signed in during this time.</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {list.map(p => (
          <details key={p.userId} className="panel an-person">
            <summary>
              <span style={{ minWidth: 0 }}><b>{p.name || p.email || 'Account'}</b><span className="acct-sub">{p.email && p.name ? `${p.email} · ` : ''}last active {timeAgo(p.lastActive)}</span></span>
              <span className="src" style={{ textAlign: 'right', flex: 'none' }}>{p.sessions} {p.sessions === 1 ? 'visit' : 'visits'}<br />{secondsText(p.totalSeconds)}</span>
            </summary>
            <dl className="an-dl">
              <dt>Account created</dt><dd>{day(p.accountCreated)}</dd>
              <dt>Last sign-in</dt><dd>{p.lastSignIn ? `${day(p.lastSignIn)} ${clock(p.lastSignIn)}` : 'Unknown'}</dd>
              <dt>Pages opened</dt><dd>{p.pageViews}</dd>
              <dt>Device</dt><dd>{p.device ?? 'Unknown'}</dd>
              <dt>Approximate region</dt><dd>{zoneLabel(p.timeZone)}</dd>
              <dt>Recent pages</dt><dd>{p.recentPages.length ? p.recentPages.map(pageLabel).join(' · ') : 'None'}</dd>
              <dt>Recent actions</dt><dd>{p.recentEvents.length ? p.recentEvents.map(eventLabel).join(' · ') : 'None'}</dd>
            </dl>
          </details>
        ))}
      </div>
    </>
  );
}

function VisitRow({ v, open, onToggle }: { v: Visit; open: boolean; onToggle: () => void }) {
  const mins = minutesBetween(v.startedAt, v.lastSeenAt);
  const trail = useAsync(() => (open ? fetchVisitPages(v.sessionId) : Promise.resolve([])), [open, v.sessionId, v.lastSeenAt]);
  return (
    <div style={{ borderTop: '1px solid var(--line)' }}>
      <button type="button" className="acct-row visit-row" aria-expanded={open} onClick={onToggle}>
        <span style={{ minWidth: 0, textAlign: 'left' }}>
          <b>{v.online && <span className="dot-live" aria-label="online" />}{who(v)}</b>
          <span className="acct-sub">{v.online ? 'Now on' : 'Last on'}: {pageLabel(v.path)} · {durationText(mins)} · {v.pageCount} {v.pageCount === 1 ? 'page' : 'pages'} · {v.device ?? 'device unknown'}</span>
          <span className="acct-sub">{v.email && v.name ? `${v.email} · ` : ''}from {clock(v.startedAt)}, last seen {timeAgo(v.lastSeenAt)}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }}><path d="m9 6 6 6-6 6" /></svg>
      </button>
      {open && (
        <ol className="visit-trail">
          {trail.loading && <li className="muted">Loading…</li>}
          {(trail.data ?? []).map((p, i) => <li key={i}><span className="src">{clock(p.at)}</span> {pageLabel(p.path)} <span className="src">{p.path}</span></li>)}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bug reports
const FILTERS = [['new', 'New'], ['seen', 'Seen'], ['fixed', 'Fixed'], ['all', 'All']] as const;
type Filter = (typeof FILTERS)[number][0];
const STATUS_LABEL: Record<BugStatus, string> = { new: 'New', seen: 'Seen', fixed: 'Fixed', wontfix: "Won't fix" };

/** Owner: bug reports sent with the header button. */
export function PlatformBugsPage() {
  useDocumentTitle('Bug reports · Platform');
  return <PlatformGate><Bugs /></PlatformGate>;
}

function Bugs() {
  const [filter, setFilter] = useState<Filter>('new');
  const [key, setKey] = useState(0);
  const reports = useAsync(() => fetchBugReports(filter === 'all' ? null : filter), [filter, key]);
  return (
    <section className="plat fade-in" style={{ display: 'grid', gap: 20 }}>
      <p><Link className="more" to="/platform">← Platform</Link></p>
      <PageHead eyebrow="Platform" title="Bug reports" lede="Sent with the bug button in the header. The page, app version and device come with each one." />
      <Seg scroll label="Show" value={filter} options={FILTERS} onChange={setFilter} />
      {reports.error != null && <p role="alert" style={bad}>{friendlyError(reports.error, 'Could not load bug reports.')}</p>}
      {reports.loading && !reports.data && <p className="muted">Loading…</p>}
      {!reports.loading && (reports.data ?? []).length === 0 && <p className="muted">{filter === 'new' ? 'No new reports. 🎉' : 'Nothing here.'}</p>}
      <div style={{ display: 'grid', gap: 12 }}>{(reports.data ?? []).map(r => <BugCard key={r.id} r={r} onChanged={() => setKey(k => k + 1)} />)}</div>
    </section>
  );
}

function BugCard({ r, onChanged }: { r: BugReport; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const mark = async (s: BugStatus) => {
    setBusy(true); setProblem(null);
    try { await setBugStatus(r.id, s); onChanged(); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); }
  };
  const openShot = async () => {
    if (!r.screenshotPath) return;
    try { setShot(await screenshotUrl(r.screenshotPath)); } catch (e) { setProblem(friendlyError(e, 'Could not open the screenshot.')); }
  };
  return (
    <article className="panel info" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip tone={r.status === 'new' ? 'live' : r.status === 'fixed' ? 'win' : ''}>{STATUS_LABEL[r.status]}</Chip>
        <span className="src">{timeAgo(r.createdAt)} · {r.name || r.email || (r.contact ? `Visitor (${r.contact})` : 'Visitor (not signed in)')}</span>
      </div>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.what}</p>
      {r.expected && <p className="muted" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><b>Expected:</b> {r.expected}</p>}
      <p className="src" style={{ overflowWrap: 'anywhere' }}>
        Page: {r.path ? <Link to={r.path}>{r.path}</Link> : 'unknown'} ({pageLabel(r.path ?? '')}) · {r.screen ?? 'screen ?'} · {r.appVersion ?? 'version ?'}
        {r.email && r.name ? ` · ${r.email}` : ''}
      </p>
      {r.userAgent && <details><summary className="src">Device details</summary><p className="src" style={{ overflowWrap: 'anywhere' }}>{r.userAgent}</p></details>}
      {r.screenshotPath && !shot && <div><button type="button" className="btn btn-line btn-sm" onClick={() => void openShot()}>Show screenshot</button></div>}
      {shot && <a href={shot} target="_blank" rel="noopener noreferrer"><img src={shot} alt="Screenshot sent with the report" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--line)' }} /></a>}
      {problem && <p role="alert" style={bad}>{problem}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {r.status !== 'seen' && r.status !== 'fixed' && <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void mark('seen')}>Mark seen</button>}
        {r.status !== 'fixed' && <button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={() => void mark('fixed')}>Mark fixed</button>}
        {r.status !== 'wontfix' && r.status !== 'fixed' && <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void mark('wontfix')}>Won't fix</button>}
        {r.status !== 'new' && <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void mark('new')}>Reopen</button>}
      </div>
    </article>
  );
}
