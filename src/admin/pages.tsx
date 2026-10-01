import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip, Seg } from '../components/ui';
import { drawPools } from '../lib/draw';
import { structureAdvice } from '../lib/tournament';
import { useAdmin } from './AdminContext';
import { COMPETITION_ROWS, RUMBLE, STAFF, type Registration } from './data';
import { Gate, Head } from './Gate';

const daysUntil = (iso: string) => Math.ceil((new Date(`${iso}T23:59:59`).getTime() - Date.now()) / 86400000);
const fighterSigned = (r: Registration) => r.fighters.filter(f => f.waiver).length;
const accepted = (regs: Registration[]) => regs.filter(r => r.status === 'accepted');

/* ---------------------------------------------------------------- overview */
export function OverviewPage() {
  const { role, regs } = useAdmin();
  const pending = regs.filter(r => r.status === 'pending');
  const acc = accepted(regs);
  const unsigned = acc.flatMap(r => r.fighters.filter(f => !f.waiver).map(f => `${f.name} (${r.name})`));
  const unpaid = acc.filter(r => !r.paid);
  const newTeams = regs.filter(r => r.newTeam);
  const close = daysUntil(RUMBLE.registrationCloses);
  const rows: { tone: '' | 'w' | 'ok'; title: string; text: string; to: string; cta: string }[] = [
    { tone: pending.length ? '' : 'ok', title: `${pending.length} registrations to review`, text: 'Teams and duelists waiting for an organizer to accept or decline.', to: '/admin/registration', cta: 'Review' },
    { tone: newTeams.length ? '' : 'ok', title: `${newTeams.length} new team${newTeams.length === 1 ? '' : 's'} waiting for approval`, text: 'A new team stays private until an organizer approves it.', to: '/admin/registration', cta: 'Approve' },
    { tone: unsigned.length ? 'w' : 'ok', title: `${unsigned.length} accepted fighters have not signed the waiver`, text: unsigned.slice(0, 3).join(', ') + (unsigned.length > 3 ? ` and ${unsigned.length - 3} more` : ''), to: '/admin/checkin', cta: 'Open check-in' },
    { tone: unpaid.length ? 'w' : 'ok', title: `${unpaid.length} accepted entries not marked paid`, text: 'Fees are tracked by hand for now. Mark entries paid as e-transfers arrive.', to: '/admin/registration', cta: 'Review' },
    { tone: 'w', title: `${COMPETITION_ROWS.filter(c => !c.drawn).length} competitions have no draw yet`, text: 'Pools and brackets are created after registration closes.', to: '/admin/competitions', cta: 'Plan draws' }
  ];
  return (
    <>
      <Head title="Overview" lede={role === 'organizer' ? 'What needs you today, and how far along the event is.' : role === 'scorekeeper' ? 'Your field and the next fights to score.' : role === 'medic' ? 'Who is cleared and who has a medical note for you.' : "Your team's registration and what is still missing."} />
      <div className="stat-strip">
        <div><b className="mono">{pending.length}</b><span>to review</span></div>
        <div><b className="mono">{acc.length}</b><span>accepted entries</span></div>
        <div><b className="mono">{acc.reduce((n, r) => n + fighterSigned(r), 0)}/{acc.reduce((n, r) => n + r.fighters.length, 0)}</b><span>waivers signed</span></div>
        <div><b className="mono">{close > 0 ? close : 0}</b><span>days until registration closes</span></div>
      </div>
      {role === 'organizer' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="panel attn">{rows.map(r => (
            <div className="attn-row" key={r.title}><span className={`dot ${r.tone}`} /><div><b>{r.title}</b><p>{r.text}</p></div><Link className="btn btn-line btn-sm" to={r.to}>{r.cta}</Link></div>
          ))}</div>
          <div className="panel info"><h3>Event setup</h3>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
              <div className="ring"><svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="40" fill="none" stroke="var(--line)" strokeWidth="9" /><circle cx="48" cy="48" r="40" fill="none" stroke="var(--win)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(4 / 9) * 251} 251`} transform="rotate(-90 48 48)" /></svg><b>4/9</b></div>
              <p style={{ color: 'var(--muted)' }}>Basics, venue, rules and divisions are done. The poster and the schedule are still missing.</p>
            </div>
            <Link className="btn btn-ink btn-sm" to="/admin/setup" style={{ justifySelf: 'start' }}>Continue setup</Link>
          </div>
        </div>
      )}
      {role === 'scorekeeper' && <div className="panel info"><h3>Your fields</h3><p style={{ color: 'var(--muted)' }}>Field 1 (group fights) and Field 2 (duels). Open the run screen to call fights and open the scoring screen.</p><Link className="btn btn-ink btn-sm" to="/admin/run" style={{ justifySelf: 'start' }}>Run the day</Link></div>}
      {role === 'medic' && <div className="panel info"><h3>Medical notes</h3><p style={{ color: 'var(--muted)' }}>{acc.flatMap(r => r.fighters).filter(f => f.note).length} accepted fighters left a note. Open check-in to read them. Notes are visible only to organizers and medics and are deleted 30 days after the event.</p><Link className="btn btn-ink btn-sm" to="/admin/checkin" style={{ justifySelf: 'start' }}>Open check-in</Link></div>}
      {role === 'captain' && <div className="panel info"><h3>Your team: Iron Wardens</h3><p style={{ color: 'var(--muted)' }}>Registered for the men's 5v5. 5 of 6 fighters have signed the waiver. Teo Villanueva has not.</p><Link className="btn btn-ink btn-sm" to="/admin/registration" style={{ justifySelf: 'start' }}>Open registration</Link></div>}
    </>
  );
}

/* ---------------------------------------------------------------- setup */
const STEPS: { state: 'complete' | 'warning' | 'missing'; title: string; text: string; cta: string }[] = [
  { state: 'complete', title: 'Basics', text: 'Red Deer Rumble, Nov 14 to 15, 2026. Hosted by Red Deer Reavers.', cta: 'Edit' },
  { state: 'complete', title: 'Venue', text: 'Horse in Hand Ranch, Blackfalds, Alberta. Mountain time.', cta: 'Edit' },
  { state: 'missing', title: 'Poster and description', text: 'No poster yet. Add one so the event card has a picture, with alt text.', cta: 'Add poster' },
  { state: 'warning', title: 'Registration', text: 'Anyone with an account can sign up; you review each one. Closes Nov 8.', cta: 'Review window' },
  { state: 'complete', title: 'Rules', text: 'Buhurt Rules V.26.4.1, Duels rules V.26.4. Each competition can use its own.', cta: 'Edit' },
  { state: 'warning', title: 'Competitions', text: '7 added, none drawn yet. Turn off the ones you will not run.', cta: 'Open' },
  { state: 'warning', title: 'Divisions', text: 'Divisions depend on the tier, which is not set yet.', cta: 'Edit' },
  { state: 'missing', title: 'Schedule', text: 'No fights scheduled. Create the draw first, then order fights per field.', cta: 'Build schedule' },
  { state: 'warning', title: 'Marshals and scorekeepers', text: '3 scorekeepers and 1 medic added. Luka B. has not signed in yet.', cta: 'Open people' }
];
const ACCESS = [['open', 'Anyone with an account', 'Organizers review and accept each signup.'], ['code', 'Only with a code', 'You hand out sign-up codes.'], ['request', 'Request permission first', 'Fighters ask, you approve, then they register.'], ['manual', 'Organizer enters everyone', 'No public signup at all.']] as const;

export function SetupPage() {
  const [access, setAccess] = useState<(typeof ACCESS)[number][0]>('open');
  const done = STEPS.filter(s => s.state === 'complete').length;
  return (
    <Gate roles={['organizer']}>
      <Head title="Setup guide" lede={`${done} of ${STEPS.length} done. Each step says what is true now and what to do next.`} />
      <div className="panel guide">{STEPS.map((s, i) => (
        <div className={`gstep ${s.state}`} key={s.title}><span className="ico" aria-hidden="true">{s.state === 'complete' ? '✓' : s.state === 'warning' ? '!' : i + 1}</span><div><b>{s.title}</b><p>{s.text}</p></div><button type="button" className="btn btn-line btn-sm">{s.cta}</button></div>
      ))}</div>
      <div className="decide"><h3>Decisions for the owner</h3>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>These change who can do what. They are never changed for you.</p>
        <div style={{ display: 'grid', gap: 8 }} role="radiogroup" aria-label="Registration access">{ACCESS.map(([k, t, d]) => (
          <button type="button" key={k} className="opt2" aria-pressed={access === k} onClick={() => setAccess(k)}><span className="radio" /><span><b>{t}</b><p>{d}</p></span></button>
        ))}</div>
        <div className="facts-grid">
          <div className="fact"><small>Entry fees</small><b>Track only</b><span>Organizers mark entries paid. Online payment is a later add-on.</span></div>
          <div className="fact"><small>Waiver</small><b>Text needed</b><span>Waiting for the owner's waiver text. No legal wording is written for you.</span></div>
          <div className="fact"><small>Medical notes</small><b>30 days</b><span>Deleted 30 days after the event. Visible to organizers and medics only.</span></div>
        </div>
      </div>
    </Gate>
  );
}

/* ---------------------------------------------------------------- competitions */
export function CompetitionsPage() {
  const { regs } = useAdmin();
  const [seed, setSeed] = useState(4821);
  const [open, setOpen] = useState<string | null>('lsw');
  const [roundsToWin, setRoundsToWin] = useState<Record<string, number>>({ m5: 2, w5: 2, m3: 2 });
  const counts = (name: string) => accepted(regs).filter(r => r.competition === name).length;
  return (
    <Gate roles={['organizer']}>
      <Head title="Competitions" lede="Each competition has its own entrants, structure and draw. The structure advice follows the Tournament Structure document." />
      <div style={{ display: 'grid', gap: 14 }}>{COMPETITION_ROWS.map(c => {
        const n = counts(c.name);
        const advice = structureAdvice(Math.max(n, 3));
        const names = accepted(regs).filter(r => r.competition === c.name).map(r => r.name);
        const opt = advice.options[advice.options.length - 1];
        const pools = opt && n >= 4 && names.length === n ? drawPools(names, opt.pools.length === 1 ? [n] : opt.pools, seed) : null;
        return (
          <div className="panel cmp" key={c.id}>
            <div className="top"><h3>{c.name}</h3><Chip>{c.league === 'buhurt' ? 'Group fight' : 'Duels'}</Chip><Chip>{c.structure}</Chip><span style={{ flex: 1 }} /><Chip tone={n ? 'steel' : ''}>{n} entered</Chip>
              <button type="button" className="btn btn-line btn-sm" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>{open === c.id ? 'Hide' : 'Plan draw'}</button></div>
            {open === c.id && (<>
              <div className="reqs">
                <div className="req"><div className="row"><span>Tier</span><b>Not set</b></div><span className="src">Announced as an official BI tournament. Set the tier to see its minimums; league points are not computed until then.</span></div>
                <div className="req"><div className="row"><span>Entrants</span><b>{n}</b></div><div className={`meter ${n === 0 ? 'bad' : ''}`}><i style={{ width: `${Math.min(100, n * 12)}%` }} /></div></div>
                {c.roundsToWin !== undefined && (
                  <label className="field-in"><span>Rounds to win a fight</span><select value={roundsToWin[c.id] ?? c.roundsToWin} onChange={e => setRoundsToWin({ ...roundsToWin, [c.id]: +e.target.value })}>{[1, 2, 3].map(v => <option key={v} value={v}>{v}</option>)}</select><span className="src">Set by the tournament regulations. Not decided yet.</span></label>
                )}
              </div>
              {advice.band === 'under-4' || n < 4 ? <p className="src">With fewer than 4 entrants, the organizer decides how to run it. Currently {n}.</p> : (
                <div className="panel info" style={{ boxShadow: 'none' }}><h3 style={{ fontSize: 20 }}>{opt.title}</h3><p style={{ color: 'var(--muted)', fontSize: 14 }}>{opt.detail}</p>
                  {pools && <div className="flow">{pools.map((p, i) => <div className="pool" style={{ textAlign: 'left', minWidth: 150 }} key={i}><small>{pools.length > 1 ? `Pool ${String.fromCharCode(65 + i)}` : 'One group'}</small>{p.map(x => <span key={x} style={{ fontSize: 14, fontWeight: 600 }}>{x}</span>)}</div>)}</div>}
                  <div className="acts"><button type="button" className="btn btn-ink btn-sm" onClick={() => setSeed(Math.floor(Math.random() * 99999))}>Redraw (new seed)</button><span className="src" style={{ alignSelf: 'center' }}>Seed {seed}: the same seed gives the same draw. Drag to adjust by hand after locking.</span></div></div>
              )}
            </>)}
          </div>
        );
      })}</div>
    </Gate>
  );
}

/* ---------------------------------------------------------------- registration */
type Filter = 'pending' | 'accepted' | 'declined' | 'all';
export function RegistrationPage() {
  const { role, regs, decide, approveTeam, togglePaid } = useAdmin();
  const [filter, setFilter] = useState<Filter>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const seeNotes = role === 'organizer' || role === 'medic';
  const base = role === 'captain' ? regs.filter(r => r.name === 'Iron Wardens') : regs;
  const list = base.filter(r => filter === 'all' || r.status === filter);
  const counts = useMemo(() => ({ pending: base.filter(r => r.status === 'pending').length, accepted: base.filter(r => r.status === 'accepted').length, declined: base.filter(r => r.status === 'declined').length, all: base.length }), [base]);
  return (
    <Gate roles={['organizer', 'captain']}>
      <Head title="Registration" lede={role === 'captain' ? 'Your team and each fighter’s paperwork.' : 'Review who signed up. Accepting adds them to the competition automatically.'} />
      <Seg label="Status" value={filter} options={(['pending', 'accepted', 'declined', 'all'] as const).map(k => [k, `${k[0].toUpperCase()}${k.slice(1)} (${counts[k]})`] as const)} onChange={setFilter} />
      <div className="panel">{list.length === 0 && <div className="attn-row"><span className="dot ok" /><div><b>Nothing here</b><p>No registrations in this view.</p></div></div>}
        {list.map(r => {
          const signed = fighterSigned(r);
          return (
            <div key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="sg">
                <span className="av person" style={{ width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--steel-soft)', color: 'var(--steel)', fontFamily: 'var(--f-display)', fontWeight: 800, border: 0 }}>{r.name.split(' ').map(x => x[0]).slice(0, 2).join('')}</span>
                <div style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{r.name}</b> <span className="src">{r.sub}</span>
                  <div className="flags"><Chip tone="steel">{r.competition}</Chip><Chip tone={signed === r.fighters.length ? 'win' : 'brass'}>Waivers {signed}/{r.fighters.length}</Chip><Chip tone={r.paid ? 'win' : ''}>{r.paid ? 'Paid' : 'Not paid'}</Chip>{r.newTeam && <Chip tone="brass">New team, not public</Chip>}
                    <Chip tone={r.status === 'accepted' ? 'win' : r.status === 'declined' ? 'live' : ''}>{r.status}</Chip></div></div>
                <div className="acts">
                  {role === 'organizer' && r.status !== 'accepted' && <button type="button" className="btn btn-ok btn-sm" onClick={() => decide(r.id, 'accepted')}>Accept</button>}
                  {role === 'organizer' && r.status !== 'declined' && <button type="button" className="btn btn-bad btn-sm" onClick={() => decide(r.id, 'declined')}>Decline</button>}
                  {role === 'organizer' && r.status !== 'pending' && <button type="button" className="btn btn-line btn-sm" onClick={() => decide(r.id, 'pending')}>Undo</button>}
                  <button type="button" className="btn btn-line btn-sm" aria-expanded={openId === r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)}>{openId === r.id ? 'Hide' : 'Fighters'}</button>
                </div>
              </div>
              {openId === r.id && (
                <div style={{ padding: '0 16px 16px 74px', display: 'grid', gap: 8 }}>
                  {r.newTeam && role === 'organizer' && <div className="conflict"><span className="chip brass">Needs approval</span><p>A captain created this team. It stays hidden from the public until you approve it. <button type="button" className="btn btn-ok btn-sm" onClick={() => approveTeam(r.id)} style={{ marginLeft: 8 }}>Approve team</button></p></div>}
                  <div className="table-wrap"><table className="mini"><thead><tr><th>Fighter</th><th>Waiver</th><th>Medically fit</th><th>Emergency contact</th><th>Medical note</th></tr></thead><tbody>
                    {r.fighters.map(f => <tr key={f.name}><td><b style={{ fontWeight: 600 }}>{f.name}</b></td><td><Chip tone={f.waiver ? 'win' : 'live'}>{f.waiver ? 'Signed' : 'Missing'}</Chip></td><td><Chip tone={f.fit ? 'win' : 'live'}>{f.fit ? 'Declared' : 'Missing'}</Chip></td><td><Chip tone={f.emergency ? 'win' : 'live'}>{f.emergency ? 'Given' : 'Missing'}</Chip></td>
                      <td>{f.note ? (seeNotes ? <span style={{ fontSize: 13 }}>{f.note}</span> : <span className="src">Hidden for your role</span>) : <span className="src">None</span>}</td></tr>)}
                  </tbody></table></div>
                  {role === 'organizer' && <label className="chk"><input type="checkbox" checked={r.paid} onChange={() => togglePaid(r.id)} /> Entry fee received (tracked by hand)</label>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Gate>
  );
}

/* ---------------------------------------------------------------- check-in */
export function CheckinPage() {
  const { role, regs, checks, toggleCheck } = useAdmin();
  const [onlyOpen, setOnlyOpen] = useState(false);
  const rows = accepted(regs).flatMap(r => r.fighters.map((f, i) => ({ r, f, key: `${r.id}:${i}` })));
  const cleared = (x: (typeof rows)[number]) => !!(checks[x.key]?.in && checks[x.key]?.kit && x.f.waiver && x.f.fit);
  const shown = rows.filter(x => !onlyOpen || !cleared(x));
  const seeNotes = role === 'organizer' || role === 'medic';
  return (
    <Gate roles={['organizer', 'medic']}>
      <Head title="Check-in" lede="A fighter is cleared when they are checked in, their kit passed, the waiver is signed and the medically-fit declaration is in.">
        <label className="chk"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> Show only not cleared</label>
      </Head>
      <div className="stat-strip"><div><b className="mono">{rows.filter(cleared).length}/{rows.length}</b><span>fighters cleared</span></div><div><b className="mono">{rows.filter(x => !x.f.waiver).length}</b><span>waivers missing</span></div><div><b className="mono">{rows.filter(x => checks[x.key]?.in).length}</b><span>checked in</span></div><div><b className="mono">{rows.filter(x => x.f.note).length}</b><span>medical notes</span></div></div>
      <div className="panel">{shown.map(x => (
        <div className="rrow" key={x.key}>
          <div className="rsum" style={{ cursor: 'default' }}>
            <span className="person" style={{ border: 0, background: 'none', padding: 0 }}><span className="av">{x.f.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span></span>
            <div style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{x.f.name}</b> <span className="src">{x.r.name} · {x.r.competition}</span>
              {seeNotes && x.f.note && <div className="src" style={{ marginTop: 4 }}>🔒 Medical note: {x.f.note}</div>}</div>
            <Chip tone={cleared(x) ? 'win' : 'brass'}>{cleared(x) ? 'Cleared' : 'Not cleared'}</Chip>
          </div>
          <div className="rchecks">
            <button type="button" className="ck" aria-pressed={!!checks[x.key]?.in} onClick={() => toggleCheck(x.key, 'in')}><span className="box">✓</span>Checked in</button>
            <button type="button" className="ck" aria-pressed={!!checks[x.key]?.kit} onClick={() => toggleCheck(x.key, 'kit')}><span className="box">✓</span>Kit check</button>
            <button type="button" className="ck na" aria-pressed={x.f.waiver} tabIndex={-1}><span className="box">{x.f.waiver ? '✓' : ''}</span>{x.f.waiver ? 'Waiver signed' : 'Waiver missing'}</button>
            <button type="button" className="ck na" aria-pressed={x.f.fit} tabIndex={-1}><span className="box">{x.f.fit ? '✓' : ''}</span>{x.f.fit ? 'Medically fit' : 'Fit declaration missing'}</button>
          </div>
        </div>
      ))}{shown.length === 0 && <div className="attn-row"><span className="dot ok" /><div><b>Everyone shown is cleared</b><p>Nothing left to check.</p></div></div>}</div>
      <p className="src">Waiver and fit declaration come from the fighter’s own signup, so they cannot be ticked here. Medical notes are shown only to organizers and medics.</p>
    </Gate>
  );
}

/* ---------------------------------------------------------------- run the day */
export function RunPage() {
  const { queues, advance } = useAdmin();
  const label = { queued: 'Queued', called: 'Called to list', live: 'Live', done: 'Done' } as const;
  return (
    <Gate roles={['organizer', 'scorekeeper']}>
      <Head title="Run the day" lede="Call the next fight, start it, and open the scoring screen. One scorekeeper per field records the result the marshals agree on." />
      <div className="fields">{queues.map((f, qi) => (
        <div className="panel qcard" key={f.name}><div className="fh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ fontSize: 24 }}>{f.name}</h3><Chip tone="live">Running</Chip></div>
          {f.items.map(it => (
            <div key={it.id} className={`qslot ${it.state === 'live' ? 'now' : ''}`} style={{ opacity: it.state === 'done' ? 0.55 : 1 }}>
              <span className="k">{label[it.state]}</span>
              <div style={{ minWidth: 0 }}><b>{it.a} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>v</span> {it.b}</b><small>{it.label}</small>
                <div className="acts" style={{ marginTop: 8 }}>
                  {it.state === 'queued' && <button type="button" className="btn btn-line btn-sm" onClick={() => advance(qi, it.id, 'called')}>Call to list</button>}
                  {it.state === 'called' && <button type="button" className="btn btn-ink btn-sm" onClick={() => advance(qi, it.id, 'live')}>Start fight</button>}
                  {it.state === 'live' && <><Link className="btn btn-ink btn-sm" to={`/marshal?mode=${f.mode}`}>Open scoring</Link><button type="button" className="btn btn-line btn-sm" onClick={() => advance(qi, it.id, 'done')}>Mark done</button></>}
                  {it.state !== 'queued' && it.state !== 'done' && <button type="button" className="btn btn-line btn-sm" onClick={() => advance(qi, it.id, 'queued')}>Put back</button>}
                </div></div></div>
          ))}</div>
      ))}</div>
    </Gate>
  );
}

/* ---------------------------------------------------------------- people */
export function PeoplePage() {
  const [staff, setStaff] = useState(STAFF);
  const [email, setEmail] = useState('');
  const [roleSel, setRoleSel] = useState('Scorekeeper');
  const [code, setCode] = useState<string | null>(null);
  const invite = () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return;
    setStaff([...staff, { name: email, role: roleSel, note: 'Invited, has not signed in yet' }]);
    setCode(`RR-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`);
    setEmail('');
  };
  return (
    <Gate roles={['organizer']}>
      <Head title="People and access" lede="Add scorekeepers, marshals and a medic by email. Roles apply to this event only." />
      <div className="panel board"><table><thead><tr><th>Person</th><th>Role</th><th>Note</th></tr></thead><tbody>{staff.map(s => <tr key={s.name}><td><b style={{ fontWeight: 600 }}>{s.name}</b></td><td><Chip tone={s.role === 'Organizer' ? 'steel' : s.role === 'Medic' ? 'brass' : ''}>{s.role}</Chip></td><td className="src" style={{ fontSize: 13 }}>{s.note}</td></tr>)}</tbody></table></div>
      <div className="panel info"><h3>Invite someone</h3>
        <div className="form"><label className="field-in"><span>Email</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
          <label className="field-in"><span>Role</span><select value={roleSel} onChange={e => setRoleSel(e.target.value)}><option>Scorekeeper</option><option>Marshal</option><option>Medic</option><option>Organizer</option></select></label>
          <button type="button" className="btn btn-ink" onClick={invite}>Create invite</button></div>
        {code && <div className="codebox"><code>{code}</code><small>Shown once. Only the first characters are stored, so a lost code is replaced, not recovered.</small></div>}
      </div>
      <div className="facts-grid">
        <div className="fact"><small>Organizer</small><b>Everything</b><span>Setup, registration, draws, check-in, running the day, people.</span></div>
        <div className="fact"><small>Scorekeeper</small><b>Scores</b><span>Calls fights and records results. Cannot see medical notes or change registrations.</span></div>
        <div className="fact"><small>Medic</small><b>Health</b><span>Reads medical notes and check-in. Cannot score or change entries.</span></div>
      </div>
    </Gate>
  );
}
