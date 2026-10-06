import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from '../Dialog';
import { RulePicker } from '../rules/RulesSheet';
import {
  closeFinding, decideReview, endEventSanction, fetchCardTypes, fetchReviewRules, issueEventSanction, issueSuspension, liftSuspension, lodgeReview, newCommandId, recordFinding,
  OUTCOME_WORD, REVIEW_WORD, SANCTION_WORD, SEVERITY_WORD, withdrawReview,
  type DisciplineOverview, type EventSanction, type Finding, type Review, type RuleRef, type SanctionKind
} from '../../data/discipline';
import { fetchEventReadiness } from '../../data/readiness';
import type { DisciplineLogRow } from '../../data/rules';
import type { ReadinessRow } from '../../lib/readiness';
import { describeRow } from '../../lib/rules/disciplineLog';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';

export type DeskTab = 'sanctions' | 'authenticity' | 'appeals' | 'suspensions';
interface Comp { id: string; name: string }
const GB = 'Buhurt International';
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Pack 22: the event's discipline desk beside the cards log. Officials record what the Knight Marshal, the Authenticity Officer or the organizers
 * decided, cite the rule, and see the consequences people must act on. Every action asks for a reason, the dangerous ones ask twice, and the database
 * checks each person's authority again. Nothing here decides a penalty or changes a score by itself.
 */
export function DisciplineDesk({ tab, eventId, competitions, overview, log, onChanged }: {
  tab: DeskTab; eventId: string; competitions: Comp[]; overview: DisciplineOverview; log: DisciplineLogRow[]; onChanged: () => void;
}) {
  if (tab === 'sanctions') return <SanctionsPanel eventId={eventId} competitions={competitions} o={overview} onChanged={onChanged} />;
  if (tab === 'authenticity') return <AuthenticityPanel eventId={eventId} o={overview} onChanged={onChanged} />;
  if (tab === 'appeals') return <AppealsPanel o={overview} log={log} onChanged={onChanged} />;
  return <SuspensionsPanel eventId={eventId} competitions={competitions} o={overview} onChanged={onChanged} />;
}

/* ---------------------------------------------------------------- shared pieces */
function RuleCite({ r }: { r: RuleRef | null }) {
  if (!r) return null;
  return <span className="rl-cite">Rule: <Link className="lnk" to={`/rules/r/${r.id}`}>{r.number ? `${r.number} ` : ''}{r.title ?? ''}</Link>{r.document ? ` (${r.document} ${r.version})` : ` (${r.version})`}</span>;
}

/** People taking part (from the desk's readiness list, which the database limits to desk staff). */
function usePeople(eventId: string, enabled: boolean) {
  return useAsync(() => (enabled ? fetchEventReadiness(eventId) : Promise.resolve([] as ReadinessRow[])), [eventId, enabled]);
}
interface Picked { registrationId: string | null; fighterId: string | null; teamId: string | null; name: string }
function PersonPicker({ people, value, onChange, teams = false }: { people: ReadinessRow[]; value: Picked | null; onChange: (p: Picked | null) => void; teams?: boolean }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const opts: Picked[] = [];
    if (teams) {
      const seen = new Set<string>();
      for (const p of people) if (p.teamId && p.teamName && !seen.has(p.teamId)) { seen.add(p.teamId); opts.push({ registrationId: null, fighterId: null, teamId: p.teamId, name: p.teamName }); }
    } else {
      for (const p of people) if (p.fighterId && !p.isVolunteer) opts.push({ registrationId: p.registrationId, fighterId: p.fighterId, teamId: null, name: p.fullName });
    }
    const n = q.trim().toLowerCase();
    return (n ? opts.filter(o => o.name.toLowerCase().includes(n)) : opts).slice(0, 8);
  }, [people, q, teams]);
  if (value) return <div className="rl-picked"><span className="chip steel">{value.name}</span><button type="button" className="btn btn-line btn-sm" onClick={() => onChange(null)}>Change</button></div>;
  return (
    <div className="rl-pick">
      <label className="rulesearch"><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={teams ? 'Find the team' : 'Find the fighter'} aria-label={teams ? 'Find the team' : 'Find the fighter'} autoComplete="off" /></label>
      {list.map(o => <button key={(o.fighterId ?? o.teamId)!} type="button" className="rl-pickrow" onClick={() => { onChange(o); setQ(''); }}><span className="rl-main"><b className="rl-title">{o.name}</b></span></button>)}
      {!list.length && <p className="rl-none">{people.length ? 'Nobody matches.' : 'Nobody is registered yet.'}</p>}
    </div>
  );
}

/** A form inside a sheet: what it does, the inputs, a reason, and a confirm step for the dangerous ones. */
function ActionSheet({ title, onClose, children, canSubmit, submitLabel, danger = false, confirmText, run }: {
  title: string; onClose: () => void; children: ReactNode; canSubmit: boolean; submitLabel: string; danger?: boolean; confirmText?: string; run: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const go = async () => {
    if (confirmText && !confirming) { setConfirming(true); return; }
    setBusy(true); setErr(null);
    try { await run(); onClose(); } catch (e) { setErr(friendlyError(e, 'That did not go through. Try again.')); setConfirming(false); } finally { setBusy(false); }
  };
  return (
    <Dialog title={title} variant="drawer" onClose={onClose} busy={busy}>
      <div className="dd-form">
        {children}
        {err && <p role="alert" className="dd-err">{err}</p>}
        <div className="dd-actions">
          {confirming && confirmText && <p className="rl-banner rl-warn dd-confirm" role="alert"><b>Check before you confirm.</b> {confirmText}</p>}
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-ink'}`} disabled={!canSubmit || busy} onClick={() => void go()}>{busy ? 'Saving…' : confirming ? `Yes, ${submitLabel.toLowerCase()}` : submitLabel}</button>
          <button type="button" className="btn btn-line" disabled={busy} onClick={confirming ? () => setConfirming(false) : onClose}>{confirming ? 'Go back' : 'Cancel'}</button>
        </div>
      </div>
    </Dialog>
  );
}
function Reason({ value, onChange, label = 'Reason', hint, required = true }: { value: string; onChange: (s: string) => void; label?: string; hint?: string; required?: boolean }) {
  return (
    <label className="field-in">{label}{required ? '' : ' (optional)'}
      <textarea rows={3} value={value} maxLength={300} onChange={e => onChange(e.target.value)} />
      {hint && <span className="src">{hint}</span>}
    </label>
  );
}
const enough = (s: string) => s.trim().length >= 3;

/* ---------------------------------------------------------------- sanctions outside a fight */
function SanctionsPanel({ eventId, competitions, o, onChanged }: { eventId: string; competitions: Comp[]; o: DisciplineOverview; onChanged: () => void }) {
  const [giving, setGiving] = useState(false);
  const [ending, setEnding] = useState<EventSanction | null>(null);
  const active = o.sanctions.filter(s => s.status === 'active');
  const ended = o.sanctions.filter(s => s.status !== 'active');
  return (
    <section className="dd-panel" aria-labelledby="dd-sanc">
      <div className="dd-head"><h2 id="dd-sanc" className="rl-h2">Sanctions outside a fight</h2>{o.can.sanction && <button type="button" className="btn btn-ink btn-sm" onClick={() => setGiving(true)}>Give a sanction</button>}</div>
      <p className="src">Given by the Knight Marshal (head marshal) or an organizer at event level: a card outside a fight, a removal, a team disqualification. Cards given in a fight are on the field tablet and in the cards log.</p>
      {!o.can.sanction && <p className="src">You can read these; the head marshal or an organizer gives them.</p>}
      {active.length === 0 && ended.length === 0 && <p className="rl-none">No sanctions outside a fight at this event.</p>}
      <ul className="dd-list">
        {active.map(s => <SanctionItem key={s.id} s={s} action={(o.can.sanction || (s.card_key === 'green_card' && o.can.green_card)) ? <button type="button" className="btn btn-line btn-sm" onClick={() => setEnding(s)}>{s.card_key === 'green_card' ? 'Remove' : 'Withdraw'}</button> : null} />)}
        {ended.map(s => <SanctionItem key={s.id} s={s} />)}
      </ul>
      {giving && <GiveSanction eventId={eventId} competitions={competitions} onClose={() => setGiving(false)} onDone={onChanged} />}
      {ending && <EndSanction s={ending} onClose={() => setEnding(null)} onDone={onChanged} />}
    </section>
  );
}
function SanctionItem({ s, action }: { s: EventSanction; action?: ReactNode }) {
  return (
    <li className={s.status === 'active' ? '' : 'void'}>
      <span className="dd-what"><b>{s.against ?? 'Unknown'}</b> · {s.kind === 'card' ? s.label : SANCTION_WORD[s.kind]}{s.competition ? ` · ${s.competition}` : ''}{s.status !== 'active' ? ` · ${s.status}` : ''}</span>
      <span className="dl-where">{when(s.created_at)}{s.issued_by_name ? ` · recorded by ${s.issued_by_name}` : ''}{s.reason ? ` · ${s.reason}` : ''}</span>
      <RuleCite r={s.rule} />
      {s.end_reason && <span className="dl-where">{s.status === 'removed' ? 'Removed' : 'Withdrawn'}: {s.end_reason}</span>}
      {action}
    </li>
  );
}
function GiveSanction({ eventId, competitions, onClose, onDone, greenOnly = false }: { eventId: string; competitions: Comp[]; onClose: () => void; onDone: () => void; greenOnly?: boolean }) {
  const people = usePeople(eventId, true);
  const cards = useAsync(fetchCardTypes, []);
  const [kind, setKind] = useState<SanctionKind>('card');
  const [card, setCard] = useState<string>(greenOnly ? 'green_card' : 'yellow_card');
  const [who, setWho] = useState<Picked | null>(null);
  const [comp, setComp] = useState('');
  const [rule, setRule] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const isTeam = kind === 'team_disqualification';
  const cardOptions = (cards.data ?? []).filter(c => c.governing_body === GB && c.issued_at_event);
  const label = kind === 'card' ? cardOptions.find(c => c.key === card)?.label ?? 'card' : SANCTION_WORD[kind].toLowerCase();
  return (
    <ActionSheet title={greenOnly ? 'Give a green card' : 'Give a sanction'} onClose={onClose} canSubmit={!!who && enough(reason)} submitLabel={greenOnly ? 'Give the green card' : 'Record it'} danger={kind !== 'card' && kind !== 'warning'}
      confirmText={`${who?.name ?? 'This person'}: ${label}${comp ? ` in ${competitions.find(c => c.id === comp)?.name}` : ''}. It is recorded with your name and the reason, and only withdrawn with a reason.`}
      run={async () => { await issueEventSanction({ event: eventId, kind, fighter: who?.fighterId, team: who?.teamId, competition: comp || null, cardKey: kind === 'card' ? card : null, provision: rule, reason }); onDone(); }}>
      {!greenOnly && (
        <label className="field-in">What
          <select value={kind} onChange={e => { setKind(e.target.value as SanctionKind); setWho(null); }}>
            <option value="card">A card</option><option value="warning">A warning</option><option value="removal">Removal from the event</option>
            <option value="disqualification">Disqualification</option><option value="team_disqualification">Team disqualification</option>
          </select>
        </label>
      )}
      {kind === 'card' && !greenOnly && (
        <label className="field-in">Card
          <select value={card} onChange={e => setCard(e.target.value)}>{cardOptions.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          {card === 'green_card' && <span className="src">A green card is an authenticity warning, not a yellow card. One per competitor at the event.</span>}
        </label>
      )}
      <div className="field-in">{isTeam ? 'Team' : 'Fighter'}
        {people.loading ? <span className="src">Loading…</span> : people.error != null ? <span className="src">{friendlyError(people.error, 'Could not load the people at this event.')}</span>
          : <PersonPicker people={people.data ?? []} value={who} onChange={setWho} teams={isTeam} />}
      </div>
      <label className="field-in">Competition {isTeam ? '' : '(optional)'}
        <select value={comp} onChange={e => setComp(e.target.value)}><option value="">The whole event</option>{competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>
      <div className="field-in">Rule (optional)<RulePicker value={rule} onChange={setRule} /></div>
      <Reason value={reason} onChange={setReason} hint="What happened, in a few words. Staff only: the fighter does not see it." />
    </ActionSheet>
  );
}
function EndSanction({ s, onClose, onDone }: { s: EventSanction; onClose: () => void; onDone: () => void }) {
  const green = s.card_key === 'green_card';
  const [reason, setReason] = useState('');
  return (
    <ActionSheet title={green ? 'Remove the green card' : 'Withdraw this sanction'} onClose={onClose} canSubmit={enough(reason)} submitLabel={green ? 'Remove it' : 'Withdraw it'} danger
      confirmText={green ? 'Remove only after the authenticity officer in charge has validated the correction. The card stays in the history.' : 'The sanction stays in the history, marked withdrawn, with your reason.'}
      run={async () => { await endEventSanction(s.id, green ? 'removed' : 'withdrawn', reason); onDone(); }}>
      <p><b>{s.against}</b> · {s.kind === 'card' ? s.label : SANCTION_WORD[s.kind]}</p>
      <Reason value={reason} onChange={setReason} hint={green ? 'For example: the item was replaced and checked.' : 'For example: recorded against the wrong fighter; appeal upheld.'} />
    </ActionSheet>
  );
}

/* ---------------------------------------------------------------- authenticity */
function AuthenticityPanel({ eventId, o, onChanged }: { eventId: string; o: DisciplineOverview; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [green, setGreen] = useState(false);
  const [closing, setClosing] = useState<Finding | null>(null);
  const [removing, setRemoving] = useState<EventSanction | null>(null);
  const greens = o.sanctions.filter(s => s.card_key === 'green_card');
  const open = o.findings.filter(f => f.status === 'open');
  return (
    <section className="dd-panel" aria-labelledby="dd-auth">
      <div className="dd-head"><h2 id="dd-auth" className="rl-h2">Authenticity</h2>
        {o.can.finding && <span className="dd-btns"><button type="button" className="btn btn-ink btn-sm" onClick={() => setAdding(true)}>Record an infraction</button><button type="button" className="btn btn-line btn-sm" onClick={() => setGreen(true)}>Give a green card</button></span>}</div>
      <p className="src">The authenticity officer (inspector role) records infractions as the official Infractions document classifies them: minor, moderate or major. What that means for a tournament (a green card, not allowed in the list) is decided by the officer and the document: BuhurtOS does not compute it. <Link className="lnk" to="/rules?q=infraction">Read the classification</Link>.</p>
      <h3 className="dd-sub">Green cards <span className="mono">{greens.filter(g => g.status === 'active').length}</span></h3>
      {greens.length === 0 ? <p className="rl-none">No green cards at this event.</p> : (
        <ul className="dd-list">{greens.map(s => <SanctionItem key={s.id} s={s} action={s.status === 'active' && o.can.green_card ? <button type="button" className="btn btn-line btn-sm" onClick={() => setRemoving(s)}>Remove (correction validated)</button> : null} />)}</ul>
      )}
      <h3 className="dd-sub">Infractions <span className="mono">{open.length} open</span></h3>
      {o.findings.length === 0 ? <p className="rl-none">No authenticity infractions recorded.</p> : (
        <ul className="dd-list">
          {o.findings.map(f => (
            <li key={f.id} className={f.status === 'open' ? '' : 'void'}>
              <span className="dd-what"><b>{f.name}</b> · <span className={`chip ${f.severity === 'major' ? 'live' : f.severity === 'moderate' ? 'brass' : ''}`}>{SEVERITY_WORD[f.severity]}</span> {f.item}{f.status !== 'open' ? ` · ${f.status}` : ''}</span>
              <span className="dl-where">{when(f.created_at)}{f.note ? ` · ${f.note}` : ''}</span>
              <RuleCite r={f.rule} />
              {f.status === 'open' && o.can.finding && <span className="dd-btns"><button type="button" className="btn btn-line btn-sm" onClick={() => setClosing(f)}>Corrected / void</button></span>}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddFinding eventId={eventId} onClose={() => setAdding(false)} onDone={onChanged} />}
      {green && <GiveSanction eventId={eventId} competitions={[]} greenOnly onClose={() => setGreen(false)} onDone={onChanged} />}
      {closing && <CloseFinding f={closing} onClose={() => setClosing(null)} onDone={onChanged} />}
      {removing && <EndSanction s={removing} onClose={() => setRemoving(null)} onDone={onChanged} />}
    </section>
  );
}
function AddFinding({ eventId, onClose, onDone }: { eventId: string; onClose: () => void; onDone: () => void }) {
  const people = usePeople(eventId, true);
  const [who, setWho] = useState<Picked | null>(null);
  const [severity, setSeverity] = useState<Finding['severity']>('minor');
  const [item, setItem] = useState('');
  const [rule, setRule] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <ActionSheet title="Record an authenticity infraction" onClose={onClose} canSubmit={!!who?.registrationId && item.trim().length >= 2} submitLabel="Record it"
      run={async () => { await recordFinding({ registration: who!.registrationId!, severity, item, provision: rule, note: note || null }); onDone(); }}>
      <div className="field-in">Fighter{people.loading ? <span className="src">Loading…</span> : <PersonPicker people={people.data ?? []} value={who} onChange={setWho} />}</div>
      <div className="field-in">Classification
        <div className="dd-seg" role="radiogroup" aria-label="Classification">
          {(['minor', 'moderate', 'major'] as const).map(s => <button key={s} type="button" role="radio" aria-checked={severity === s} className={`btn btn-sm ${severity === s ? 'btn-ink' : 'btn-line'}`} onClick={() => setSeverity(s)}>{SEVERITY_WORD[s]}</button>)}
        </div>
      </div>
      <label className="field-in">Item<input value={item} maxLength={120} onChange={e => setItem(e.target.value)} placeholder="For example: gauntlets" /></label>
      <div className="field-in">Rule (optional)<RulePicker value={rule} onChange={setRule} /></div>
      <Reason value={note} onChange={setNote} label="Note for staff" required={false} hint="Staff only. The fighter sees the classification and the item, not this note." />
    </ActionSheet>
  );
}
function CloseFinding({ f, onClose, onDone }: { f: Finding; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<'corrected' | 'voided'>('corrected');
  const [reason, setReason] = useState('');
  return (
    <ActionSheet title="Close this infraction" onClose={onClose} canSubmit={status === 'corrected' || enough(reason)} submitLabel={status === 'corrected' ? 'Mark corrected' : 'Void it'} danger={status === 'voided'}
      confirmText={status === 'voided' ? 'Voiding says the infraction was recorded by mistake. It stays in the history with your reason.' : undefined}
      run={async () => { await closeFinding(f.id, status, reason || null); onDone(); }}>
      <p><b>{f.name}</b> · {SEVERITY_WORD[f.severity]} · {f.item}</p>
      <div className="dd-seg" role="radiogroup" aria-label="How it closes">
        <button type="button" role="radio" aria-checked={status === 'corrected'} className={`btn btn-sm ${status === 'corrected' ? 'btn-ink' : 'btn-line'}`} onClick={() => setStatus('corrected')}>Corrected</button>
        <button type="button" role="radio" aria-checked={status === 'voided'} className={`btn btn-sm ${status === 'voided' ? 'btn-ink' : 'btn-line'}`} onClick={() => setStatus('voided')}>Recorded by mistake</button>
      </div>
      <Reason value={reason} onChange={setReason} required={status === 'voided'} />
    </ActionSheet>
  );
}

/* ---------------------------------------------------------------- appeals */
function AppealsPanel({ o, log, onChanged }: { o: DisciplineOverview; log: DisciplineLogRow[]; onChanged: () => void }) {
  const [lodging, setLodging] = useState(false);
  const [deciding, setDeciding] = useState<Review | null>(null);
  const [withdrawing, setWithdrawing] = useState<Review | null>(null);
  const open = o.reviews.filter(r => r.status === 'lodged');
  return (
    <section className="dd-panel" aria-labelledby="dd-app">
      <div className="dd-head"><h2 id="dd-app" className="rl-h2">Appeals</h2>{o.can.lodge_appeal && <button type="button" className="btn btn-ink btn-sm" onClick={() => setLodging(true)}>Record an appeal</button>}</div>
      <p className="src">The captain (or the competitor's representative) tells the Secretary in person, within 15 minutes after the end of the fight and before the next phase starts. The Knight Marshal decides. <Link className="lnk" to="/rules?q=appeal">Read the appeal rules</Link>.</p>
      {o.reviews.length === 0 && <p className="rl-none">No appeals at this event.</p>}
      <ul className="dd-list">
        {o.reviews.map(r => (
          <li key={r.id} className={r.status === 'lodged' ? '' : 'void'}>
            <span className="dd-what"><b>{r.against ?? 'A fight'}</b> · {REVIEW_WORD[r.kind]}{r.status === 'decided' && r.outcome ? ` · ${OUTCOME_WORD[r.outcome] ?? r.outcome}` : r.status === 'withdrawn' ? ' · withdrawn' : ''}</span>
            <span className="dl-where">By {r.lodged_by_name} · {when(r.lodged_at)} · {r.grounds}</span>
            {r.status === 'lodged' && <span className={`dl-where ${r.late ? 'dd-late' : ''}`}>{r.late ? `Lodged after the deadline (${when(r.due_by)}): the Knight Marshal decides whether to hear it.` : `Deadline ${when(r.due_by)}`}</span>}
            {r.decision_note && <span className="dl-where">Decision: {r.decision_note}</span>}
            {r.status === 'lodged' && <span className="dd-btns">
              {o.can.decide_appeal && <button type="button" className="btn btn-ink btn-sm" onClick={() => setDeciding(r)}>Record the decision</button>}
              <button type="button" className="btn btn-line btn-sm" onClick={() => setWithdrawing(r)}>Withdrawn</button>
            </span>}
          </li>
        ))}
      </ul>
      {open.length > 0 && !o.can.decide_appeal && <p className="src">The Knight Marshal (head marshal) or an organizer records the decision.</p>}
      {lodging && <LodgeAppeal log={log} sanctions={o.sanctions} onClose={() => setLodging(false)} onDone={onChanged} />}
      {deciding && <DecideAppeal r={deciding} onClose={() => setDeciding(null)} onDone={onChanged} />}
      {withdrawing && <ActionSheet title="The appeal was withdrawn" onClose={() => setWithdrawing(null)} canSubmit submitLabel="Mark withdrawn" run={async () => { await withdrawReview(withdrawing.id, 'withdrawn by the appellant'); onChanged(); }}><p>{withdrawing.lodged_by_name} withdrew the appeal.</p></ActionSheet>}
    </section>
  );
}
function LodgeAppeal({ log, sanctions, onClose, onDone }: { log: DisciplineLogRow[]; sanctions: EventSanction[]; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState('');
  const [by, setBy] = useState('');
  const [grounds, setGrounds] = useState('False implementation of a penalty');
  const records = log.filter(r => !r.voided_at);
  const [cmd] = useState(newCommandId);
  return (
    <ActionSheet title="Record an appeal" onClose={onClose} canSubmit={!!target && by.trim().length >= 2 && enough(grounds)} submitLabel="Record it"
      run={async () => {
        const [k, id] = target.split(':');
        await lodgeReview({ kind: 'event_appeal', lodgedBy: by, grounds, matchDiscipline: k === 'm' ? id : null, eventSanction: k === 's' ? id : null, match: k === 'f' ? id : null }, cmd);
        onDone();
      }}>
      <label className="field-in">What it is about
        <select value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">Choose…</option>
          <optgroup label="A record from a fight">{records.map(r => <option key={r.id} value={`m:${r.id}`}>{r.against ?? '?'} · {describeRow(r)} · {r.competition_name}{r.round_label ? ` · ${r.round_label}` : ''}</option>)}</optgroup>
          <optgroup label="A fight (nothing was recorded)">{[...new Map(log.map(r => [r.match_id, r])).values()].map(r => <option key={r.match_id} value={`f:${r.match_id}`}>{r.competition_name}{r.round_label ? ` · ${r.round_label}` : ''}{r.field ? ` · ${r.field}` : ''}</option>)}</optgroup>
          <optgroup label="A sanction outside a fight">{sanctions.filter(s => s.status === 'active').map(s => <option key={s.id} value={`s:${s.id}`}>{s.against} · {s.kind === 'card' ? s.label : SANCTION_WORD[s.kind]}</option>)}</optgroup>
        </select>
      </label>
      <label className="field-in">Who appeals<input value={by} maxLength={80} onChange={e => setBy(e.target.value)} placeholder="For example: the captain of Team X" /></label>
      <label className="field-in">Grounds
        <select value={grounds} onChange={e => setGrounds(e.target.value)}>
          <option>False implementation of a penalty</option><option>Unregistered rule violation by the opponent</option><option>Unregistered clean blows (duels)</option><option>Other</option>
        </select>
      </label>
    </ActionSheet>
  );
}
function DecideAppeal({ r, onClose, onDone }: { r: Review; onClose: () => void; onDone: () => void }) {
  const rules = useAsync(fetchReviewRules, []);
  const outcomes = rules.data?.find(x => x.kind === r.kind && x.governing_body === GB)?.outcomes ?? [];
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [apply, setApply] = useState(false);
  const canApply = (outcome === 'cards_withdrawn' || outcome === 'revoked') && (r.match_discipline_id || r.event_sanction_id);
  return (
    <ActionSheet title="Record the Knight Marshal's decision" onClose={onClose} canSubmit={!!outcome} submitLabel="Record the decision" danger={!!(apply && canApply)}
      confirmText={apply && canApply ? (r.match_discipline_id ? 'The card from the fight will be voided with this decision as its reason. If the fight result is already final, it must be reopened first.' : 'The sanction will be withdrawn with this decision as its reason.') : 'The decision is final and recorded with your name.'}
      run={async () => { await decideReview(r.id, outcome, note || null, !!(apply && canApply)); onDone(); }}>
      <p><b>{r.against ?? 'A fight'}</b> · {r.grounds}</p>
      <label className="field-in">Decision
        <select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="">Choose…</option>{outcomes.map(x => <option key={x} value={x}>{OUTCOME_WORD[x] ?? x}</option>)}</select>
      </label>
      {canApply && <label className="rl-check"><input type="checkbox" checked={apply} onChange={e => setApply(e.target.checked)} /> Also {r.match_discipline_id ? 'void the card from the fight' : 'withdraw the sanction'}</label>}
      {(outcome === 'rematch_round' || outcome === 'restart') && <p className="src">Run the rematch or restart on the field tablet; this records the decision only.</p>}
      <Reason value={note} onChange={setNote} label="Note" required={false} />
    </ActionSheet>
  );
}

/* ---------------------------------------------------------------- suspensions and blocks */
function SuspensionsPanel({ eventId, competitions, o, onChanged }: { eventId: string; competitions: Comp[]; o: DisciplineOverview; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [lifting, setLifting] = useState<string | null>(null);
  return (
    <section className="dd-panel" aria-labelledby="dd-susp">
      <div className="dd-head"><h2 id="dd-susp" className="rl-h2">Who may not take part</h2>{o.can.suspend && <button type="button" className="btn btn-danger btn-sm" onClick={() => setAdding(true)}>Suspend someone</button>}</div>
      <p className="src">A suspension stops acceptance, check-in and entry, and no readiness override clears it. Lift it to clear it. Suspensions by an organization or the platform are shown here as a block only; their reasons stay with them.</p>
      <h3 className="dd-sub">Blocked at this event <span className="mono">{o.blocks.length}</span></h3>
      {o.blocks.length === 0 ? <p className="rl-none">Nobody registered here is blocked.</p> : <ul className="dd-list">{o.blocks.map(b => <li key={b.registration_id}><span className="dd-what"><b>{b.name}</b> · <span className="chip live">Blocked</span></span><span className="dl-where">{b.message}</span></li>)}</ul>}
      <h3 className="dd-sub">Suspensions by this event</h3>
      {o.event_suspensions.length === 0 ? <p className="rl-none">None.</p> : (
        <ul className="dd-list">
          {o.event_suspensions.map(s => (
            <li key={s.id} className={s.lifted_at ? 'void' : ''}>
              <span className="dd-what"><b>{s.against}</b> · {s.label}{s.lifted_at ? ' · lifted' : ''}</span>
              <span className="dl-where">{when(s.starts_at)}{s.reason ? ` · ${s.reason}` : ''}</span>
              {s.lift_reason && <span className="dl-where">Lifted: {s.lift_reason}</span>}
              {!s.lifted_at && o.can.suspend && <span className="dd-btns"><button type="button" className="btn btn-line btn-sm" onClick={() => setLifting(s.id)}>Lift</button></span>}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddSuspension eventId={eventId} competitions={competitions} onClose={() => setAdding(false)} onDone={onChanged} />}
      {lifting && <LiftSuspension id={lifting} onClose={() => setLifting(null)} onDone={onChanged} />}
    </section>
  );
}
function AddSuspension({ eventId, competitions, onClose, onDone }: { eventId: string; competitions: Comp[]; onClose: () => void; onDone: () => void }) {
  const people = usePeople(eventId, true);
  const [team, setTeam] = useState(false);
  const [who, setWho] = useState<Picked | null>(null);
  const [comp, setComp] = useState('');
  const [rule, setRule] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  return (
    <ActionSheet title="Suspend for this event" onClose={onClose} canSubmit={!!who && enough(reason)} submitLabel="Suspend" danger
      confirmText={`${who?.name ?? 'They'} will be blocked from ${comp ? competitions.find(c => c.id === comp)?.name : 'the rest of this event'}: no check-in and no entry until it is lifted. ${team ? 'The team captain' : 'The fighter'} is notified.`}
      run={async () => { await issueSuspension({ authority: 'event', scope: comp ? 'competition' : 'remainder_of_event', reason, fighter: who?.fighterId, team: who?.teamId, event: eventId, competition: comp || null, provision: rule }); onDone(); }}>
      <div className="dd-seg" role="radiogroup" aria-label="Who">
        <button type="button" role="radio" aria-checked={!team} className={`btn btn-sm ${!team ? 'btn-ink' : 'btn-line'}`} onClick={() => { setTeam(false); setWho(null); }}>A fighter</button>
        <button type="button" role="radio" aria-checked={team} className={`btn btn-sm ${team ? 'btn-ink' : 'btn-line'}`} onClick={() => { setTeam(true); setWho(null); }}>A team</button>
      </div>
      <div className="field-in">{team ? 'Team' : 'Fighter'}{people.loading ? <span className="src">Loading…</span> : <PersonPicker people={people.data ?? []} value={who} onChange={setWho} teams={team} />}</div>
      <label className="field-in">From
        <select value={comp} onChange={e => setComp(e.target.value)}><option value="">The rest of this event</option>{competitions.map(c => <option key={c.id} value={c.id}>{c.name} only</option>)}</select>
        <span className="src">A longer ban (for example a Judiciary Committee decision) is recorded by the organization or the platform, with dates.</span>
      </label>
      <div className="field-in">Rule (optional)<RulePicker value={rule} onChange={setRule} /></div>
      <Reason value={reason} onChange={setReason} hint="Staff only. The fighter is told they are suspended, not this reason." />
    </ActionSheet>
  );
}
export function LiftSuspension({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <ActionSheet title="Lift the suspension" onClose={onClose} canSubmit={enough(reason)} submitLabel="Lift it" danger confirmText="They can be accepted, checked in and entered again. The suspension stays in the history with your reason."
      run={async () => { await liftSuspension(id, reason); onDone(); }}>
      <Reason value={reason} onChange={setReason} />
    </ActionSheet>
  );
}
