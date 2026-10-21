import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { SignIn } from '../../auth/SignIn';
import { acknowledgeCounterRun, counterBind, counterLeave, counterSetOperator, counterSubmit, joinTrainingCounter, leaveSeat, type CounterField, type CounterState, type PreparedCounterRun } from '../../data/lyst';
import { isDeviceMode, storedWhoami } from '../../lib/deviceSession';
import { fieldLabel } from '../../lib/eventDay';
import { friendlyError } from '../../lib/friendlyError';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { DEFAULT_SIDES, counterBanner, fightLine, mergeSides, nextStep, onlyField, parseJoinCode, sideLabel, sideVars, standingLeft, type CounterStep } from '../../lib/lyst/counters';
import { CounterJournal } from '../../lib/lyst/counterJournal';
import { useCounterTab } from '../../lib/lyst/useCounterTab';
import { offlineShellStore, scoringGuard } from '../../lib/swUpdate';
import { SavedCounterEvidence } from '../../components/lyst/SavedCounterEvidence';
import { counterEvidenceSender } from '../../lib/lyst/sendCounterEvidence';
import { useCounterBacklog } from '../../lib/lyst/useCounterBacklog';
import { formatClock, remainingMs } from '../../lib/lyst/timer';
import { useCounterState, useNow } from '../../lib/lyst/useLystState';

const TRAIN_CODE_KEY = 'bos-lyst-train-code';
const tapsKey = (seat: string) => `bos-lyst-taps:${seat}`;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v);return localStorage.getItem(k)===v; } catch { return false; } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } }
};

/**
 * The counter's phone (Pack 25). A phone scanned the event's one Counter QR once and is event equipment for the day: the person holding it says who
 * they are, which Lyst and which side (Red or Blue), then counts. The fight it counts is whatever the Lyst opens on that field: when the next fight
 * opens, the phone follows by itself (no second QR, no seat request, no approval). What it tallies is PROVISIONAL evidence for the marshal: it never
 * becomes a score. A trainee uses their own phone and account through the Lyst's TRAINING QR, picks a side, and practises the same screen; their tally is
 * kept apart and never reaches anything official. Every tap is saved on the phone first, carries its own id, and is sent in order.
 */
export function CounterPage() {
  const shell=useSyncExternalStore(offlineShellStore.subscribe,offlineShellStore.getSnapshot);
  return <><CounterContent /><div className="cp-recovery">
    {import.meta.env.PROD && <p className="src" role="status">{shell==='ready'?'App saved for offline reopening on this browser. Keep the correct fight and round saved too.':shell==='unavailable'?'This browser could not prepare the offline app. Keep this page open and use paper if it closes.':'Preparing the app for offline reopening. Keep this page open until it is ready; use paper backup.'}</p>}
    <SavedCounterEvidence showEmpty /></div></>;
}

function CounterContent() {
  const { code: urlCode } = useParams();
  const device = isDeviceMode();
  const { session, loading } = useAuth();
  useDocumentTitle(device ? 'Counter' : 'Training counter');
  if (loading) return <main className="cp"><p className="muted">Loading…</p></main>;
  if (device) return <DeviceCounter />;
  if (!session) {
    return (
      <main className="cp-join">
        <h1>Training counter</h1>
        <p>Sign in, then you count along with the real counters as practice. Nothing you tap changes any score.</p>
        <SignIn reason="Sign in to practise counting." />
      </main>
    );
  }
  return <TrainingCounter userId={session.user.id} urlCode={parseJoinCode(urlCode)} />;
}

/* ================================================================ the phone from the Counter QR */
function DeviceCounter() {
  const w = storedWhoami();
  const cs = useCounterState(true, w?.session_id ?? 'device');
  const state = cs.state;
  const [draft, setDraft] = useState<{ operator: string; field: string | null; side: 'a' | 'b' | null }>({ operator: '', field: null, side: null });
  const [editing, setEditing] = useState<CounterStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fields = useMemo(() => [...(state?.fields ?? [])].sort((x, y) => fieldLabel(x.label).localeCompare(fieldLabel(y.label), undefined, { numeric: true })), [state?.fields]);
  const binding = state?.binding;
  const sides = state?.sides ? mergeSides(state.sides) : DEFAULT_SIDES;
  const vars = sideVars(sides) as React.CSSProperties;
  const step: CounterStep | 'loading' = !state ? 'loading' : editing ?? nextStep(binding, fields);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setProblem(null);
    try { await fn(); await cs.refresh(); setEditing(null); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); }
  };
  // the three answers: who, which Lyst, which side. Each one is sent as soon as it is known; the server keeps the phone's place.
  const saveOperator = (name: string) => {
    const operator = name.trim();
    if (operator.length < 1) return;
    setDraft(d => ({ ...d, operator }));
    if (binding?.field_key && binding.side) return run(() => counterSetOperator(operator));   // a handoff: the tally carries on
    if (binding?.operator) return run(() => counterSetOperator(operator));
    const only = onlyField(fields);
    if (only && binding?.side) return run(() => counterBind(only, binding.side ?? null, operator));
    setEditing(only ? 'side' : 'field');
    return undefined;
  };
  const chooseField = (key: string) => {
    setDraft(d => ({ ...d, field: key }));
    setEditing('side');
  };
  const chooseSide = (side: 'a' | 'b') => {
    const field = draft.field ?? binding?.field_key ?? onlyField(fields);
    const operator = draft.operator || binding?.operator || '';
    if (!field || !operator) { setEditing(!operator ? 'operator' : 'field'); return; }
    void run(() => counterBind(field, side, operator));
  };

  if (step === 'loading') {
    return <main className="cp" style={vars}><p className="muted" role="status">{cs.error != null ? friendlyError(cs.error, 'Could not reach the event.') : 'Loading…'}</p></main>;
  }
  const head = (
    <div className="cp-setup-head">
      <span className="cp-event">{state?.event?.name ?? w?.event.name}</span>
      <span className="src">Counter phone{state?.device_label ? ` · ${state.device_label}` : ''}</span>
    </div>
  );
  if (step === 'operator') {
    return (
      <main className="cp cp-setup" style={vars} aria-label="Who is counting">
        {head}
        <OperatorForm initial={binding?.operator ?? ''} busy={busy} problem={problem} onSave={saveOperator} onCancel={editing && binding?.operator ? () => setEditing(null) : undefined} />
      </main>
    );
  }
  if (step === 'field') {
    return (
      <main className="cp cp-setup" style={vars} aria-label="Which Lyst">
        {head}
        <h1 className="cp-q">Which Lyst?</h1>
        {fields.length === 0 && <p className="cp-msg">This event has no Lysts yet. Ask the organizer, then try again.</p>}
        <div className="cp-choices">
          {fields.map(f => <FieldButton key={f.key} f={f} current={binding?.field_key === f.key} onPick={() => chooseField(f.key)} busy={busy} />)}
        </div>
        {problem && <p role="alert" className="ly-error">{problem}</p>}
        {editing && binding?.field_key && <button type="button" className="ly-link" onClick={() => setEditing(null)}>Keep {fieldLabel(state?.field_label ?? 'this Lyst')}</button>}
      </main>
    );
  }
  if (step === 'side') {
    const chosen = fields.find(f => f.key === (draft.field ?? binding?.field_key ?? onlyField(fields)));
    const whichLyst = fieldLabel(chosen?.label ?? state?.field_label ?? 'this Lyst');
    return (
      <main className="cp cp-setup" style={vars} aria-label="Which side">
        {head}
        <h1 className="cp-q">Which side on {whichLyst}?</h1>
        {chosen?.now ? <p className="src cp-now" data-testid="cp-side-now">Now fighting: {chosen.now.a ?? 'Side A'} vs {chosen.now.b ?? 'Side B'}</p> : <p className="src cp-now">Nothing is on {whichLyst} yet. Your side follows the next fight.</p>}
        <div className="cp-sides">
          <button type="button" className="cp-side cp-side-a" disabled={busy} onClick={() => chooseSide('a')} aria-pressed={binding?.side === 'a'} data-testid="cp-pick-a"><span>{sides.a.name.toUpperCase()}</span><small>{chosen?.now?.a ?? 'Side A'}</small></button>
          <button type="button" className="cp-side cp-side-b" disabled={busy} onClick={() => chooseSide('b')} aria-pressed={binding?.side === 'b'} data-testid="cp-pick-b"><span>{sides.b.name.toUpperCase()}</span><small>{chosen?.now?.b ?? 'Side B'}</small></button>
        </div>
        {problem && <p role="alert" className="ly-error">{problem}</p>}
        {fields.length > 1 && <button type="button" className="ly-link" onClick={() => setEditing('field')}>Change Lyst</button>}
        {editing && binding?.side && <button type="button" className="ly-link" onClick={() => setEditing(null)}>Keep {sideLabel(binding.side, sides)}</button>}
      </main>
    );
  }
  return (
    <CountScreen key={state?.seat?.id ?? 'waiting'} state={state!} cs={cs} training={state?.training===true||state?.seat?.role==='learning'} busy={busy} problem={problem}
      onChangeOperator={() => setEditing('operator')} onChangeSide={() => setEditing('side')} onChangeField={fields.length > 1 ? () => setEditing('field') : undefined}
      onLeave={() => run(() => counterLeave())} />
  );
}

function FieldButton({ f, current, onPick, busy }: { f: CounterField; current: boolean; onPick: () => void; busy: boolean }) {
  return (
    <button type="button" className="cp-choice" disabled={busy} onClick={onPick} aria-pressed={current}>
      <b>{fieldLabel(f.label)}</b><span className="src" data-testid="cp-field-now">{f.now ? `${f.now.a ?? 'Side A'} vs ${f.now.b ?? 'Side B'}` : f.open ? 'A fight is open here' : 'No fight open yet'}{current ? ' · your Lyst now' : ''}</span>
    </button>
  );
}

function OperatorForm({ initial, busy, problem, onSave, onCancel, title = 'Who is counting?' }: { initial: string; busy: boolean; problem: string | null; onSave: (name: string) => unknown; onCancel?: () => void; title?: string }) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => { e.preventDefault(); void onSave(name); };
  return (
    <form onSubmit={submit} className="cp-form">
      <h1 className="cp-q">{title}</h1>
      <label htmlFor="cp-name" className="src">Your name. It is written beside every count you make, so the marshal knows who counted. It is not a sign-in.</label>
      <input id="cp-name" className="cp-name-in" value={name} maxLength={80} autoComplete="name" autoCapitalize="words" onChange={e => setName(e.target.value)} placeholder="For example Garrett Robson" autoFocus />
      <button type="submit" className="btn btn-ink fq-big" disabled={busy || name.trim().length < 1}>{busy ? 'Saving…' : 'Continue'}</button>
      {problem && <p role="alert" className="ly-error">{problem}</p>}
      {onCancel && <button type="button" className="ly-link" onClick={onCancel}>Keep {initial}</button>}
    </form>
  );
}

/* ================================================================ a trainee on their own phone */
function TrainingCounter({ userId, urlCode }: { userId: string; urlCode: string | null }) {
  const nav = useNavigate();
  const cs = useCounterState(true, userId);
  const state = cs.state;
  const code = urlCode ?? parseJoinCode(store.get(TRAIN_CODE_KEY));
  const [name, setName] = useState('');
  const [side, setSide] = useState<'a' | 'b' | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const sides = state?.sides ? mergeSides(state.sides) : DEFAULT_SIDES;
  useEffect(() => { if (urlCode) store.set(TRAIN_CODE_KEY, urlCode); }, [urlCode]);
  const seated = !!state?.seat && (state.seat.status === 'active');

  const join = async () => {
    if (!code || !side || name.trim().length < 1) return;
    setBusy(true); setProblem(null);
    try {
      const r = await joinTrainingCounter(code, name.trim(), side);
      if (r.status === 'invalid') { setProblem(r.message ?? 'That training code is not valid.'); store.del(TRAIN_CODE_KEY); return; }
      store.del(TRAIN_CODE_KEY); await cs.refresh();
      if (urlCode) nav('/lyst/counter', { replace: true });
    } catch (e) { setProblem(friendlyError(e, 'Could not join. Check your signal and scan again.')); } finally { setBusy(false); }
  };
  if (!state) return <main className="cp"><p className="muted" role="status">Loading…</p></main>;
  if (!seated && !code) {
    return (
      <main className="cp-join">
        <h1>Training counter</h1>
        <p>Scan the TRAINING QR on the Lyst tablet, or type its code.</p>
        <label htmlFor="cp-code" className="sr-only">Training code</label>
        <input id="cp-code" className="cp-code-in" value={typed} maxLength={14} autoCapitalize="characters" autoComplete="off" onChange={e => setTyped(e.target.value)} placeholder="CODE" />
        <button type="button" className="btn btn-ink fq-big" disabled={!parseJoinCode(typed)} onClick={() => nav(`/lyst/train/${parseJoinCode(typed)}`)}>Continue</button>
        <p className="src">Real counters do not use this: they scan the event's Counter QR on an event phone.</p>
      </main>
    );
  }
  if (!seated) {
    return (
      <main className="cp cp-setup" aria-label="Join as a training counter">
        <div className="cp-setup-head"><span className="cp-event">Training counter</span><span className="src">Practice only. Your count never changes a score.</span></div>
        <form onSubmit={e => { e.preventDefault(); void join(); }} className="cp-form">
          <h1 className="cp-q">Who is counting?</h1>
          <label htmlFor="cp-tname" className="src">Your name, as the Lyst will see it.</label>
          <input id="cp-tname" className="cp-name-in" value={name} maxLength={80} autoComplete="name" autoCapitalize="words" onChange={e => setName(e.target.value)} placeholder="Your name" autoFocus />
          <h2 className="cp-q">Which side?</h2>
          <div className="cp-sides">
            <button type="button" className="cp-side cp-side-a" aria-pressed={side === 'a'} onClick={() => setSide('a')}><span>{sides.a.name.toUpperCase()}</span><small>Side A</small></button>
            <button type="button" className="cp-side cp-side-b" aria-pressed={side === 'b'} onClick={() => setSide('b')}><span>{sides.b.name.toUpperCase()}</span><small>Side B</small></button>
          </div>
          <button type="submit" className="btn btn-ink fq-big" disabled={busy || !side || name.trim().length < 1}>{busy ? 'Joining…' : 'Start counting'}</button>
          {problem && <p role="alert" className="ly-error">{problem}</p>}
          {problem && <button type="button" className="ly-link" onClick={() => { setProblem(null); store.del(TRAIN_CODE_KEY); nav('/lyst/train', { replace: true }); }}>Type a new code</button>}
        </form>
      </main>
    );
  }
  if (renaming) {
    return (
      <main className="cp cp-setup">
        <OperatorForm initial={state.seat?.operator ?? ''} busy={busy} problem={problem} title="Your name" onCancel={() => setRenaming(false)}
          onSave={async n => { setBusy(true); setProblem(null); try { await counterSetOperator(n.trim()); await cs.refresh(); setRenaming(false); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); } }} />
      </main>
    );
  }
  return (
    <CountScreen key={state.seat?.id ?? 'waiting'} state={state} cs={cs} training busy={busy} problem={problem} onChangeOperator={() => setRenaming(true)}
      onLeave={async () => { if (!state.seat) return; setBusy(true); try { await leaveSeat(state.seat.id); store.del(tapsKey(state.seat.id)); await cs.refresh(); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); } }} />
  );
}

/* ================================================================ the counting screen (both) */
function CountScreen({ state, cs, training, busy, problem, onChangeOperator, onChangeSide, onChangeField, onLeave }: {
  state: CounterState; cs: ReturnType<typeof useCounterState>; training: boolean; busy: boolean; problem: string | null;
  onChangeOperator: () => void; onChangeSide?: () => void; onChangeField?: () => void; onLeave: () => unknown;
}) {
  const sides = state.sides ? mergeSides(state.sides) : DEFAULT_SIDES;
  const vars = sideVars(sides) as React.CSSProperties;
  const seat = state.seat;
  const seatId = seat?.id ?? '';
  const [manualRun, setManualRun] = useState<PreparedCounterRun | null>(() => {
    try {
      const cached = JSON.parse(store.get(`bos-counter-manual:${seatId}`) ?? 'null') as PreparedCounterRun | null;
      return cached?.id === state.prepared_run?.id && cached?.match_id === state.match_id ? cached : null;
    } catch { return null; }
  });
  const run = manualRun ?? state.prepared_run;
  const round = manualRun?.no ?? state.prepared_run?.no ?? state.round?.no ?? 0;
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [offline, setOffline] = useState(false);
  const lastSendEnd = useRef(0);
  const tab = useCounterTab(seatId);
  const journal = useMemo(() => new CounterJournal(seatId, {
    getItem: k => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v)
  }, () => setTick(t => t + 1)), [seatId,tab.token]);
  journal.setScope(state.match_id ?? seatId);
  const [backup, setBackup] = useState(false);
  const finishing = useRef(false);
  const refreshCounter = cs.refresh;
  useEffect(()=>{if(tab.owned)journal.activate();else journal.close();return()=>journal.close();},[journal,tab.owned]);
  useEffect(()=>{scoringGuard.enter();return()=>scoringGuard.leave();},[]);
  useEffect(()=>{
    if(tab.owned && state.match_id)journal.rememberContext(state.match_id,{event:state.event?.name??'',fight:`${state.fights?.now?.a??state.fighter??''} vs ${state.fights?.now?.b??state.opponent??''}`,field:fieldLabel(state.field_label??seat?.field_key??'')});
  },[journal,tab.owned,state.match_id,state.event?.name,state.fights?.now?.a,state.fights?.now?.b,state.fighter,state.opponent,state.field_label,seat?.field_key]);

  const send=useMemo(()=>counterEvidenceSender(seatId),[seatId]);
  const backlog=useCounterBacklog(seatId,tab.owned);

  const pump = useCallback(async () => {
    if (!seatId || !tab.owned || journal.pending.length === 0) return;
    await journal.flush(send);
    lastSendEnd.current = Date.now();
    setOffline(journal.offline);
    if (journal.held.length) setNotice('Some saved actions are kept as evidence. Open Saved counter evidence; the marshal can check their server review status.');
    if (journal.pending.length === 0) void refreshCounter();
  }, [seatId, tab.owned, journal, send, refreshCounter]);

  useEffect(() => {
    const id = window.setInterval(() => { if (journal.pending.length > 0) void pump(); }, 3000);
    const on = () => { void pump(); };
    const wake = () => { if(!document.hidden)void pump(); };
    window.addEventListener('online', on);
    document.addEventListener('visibilitychange',wake);
    return () => { window.clearInterval(id); window.removeEventListener('online', on); document.removeEventListener('visibilitychange',wake); };
  }, [pump, journal]);
  // A receipt means THIS run reached a phone and was saved, not merely that
  // its browser had a heartbeat. Missing receipts stay visible to the scorer.
  useEffect(() => {
    if (!seatId || !tab.owned || !state.prepared_run || cs.cached || !cs.cacheDurable || !journal.durable) return;
    const acknowledge = () => acknowledgeCounterRun(seatId, state.prepared_run!.id,
      state.prepared_run!.status === 'running' && !!state.can_count, journal.pending.filter(a => a.runId === state.prepared_run!.id).length).catch(() => { /* retry on poll/reconnect; never claim receipt locally */ });
    void acknowledge();
  }, [seatId, tab.owned, state.prepared_run, state.can_count, cs.cached, cs.cacheDurable, journal]);
  // the server's total is the truth when nothing is waiting, but only from an answer requested after our last send
  useEffect(() => {
    if (tab.owned && state.my_total !== undefined && state.round?.no === round && round && cs.sentAt > lastSendEnd.current && !journal.sending
      && (journal.total(round) !== state.my_total || state.my_weights && journal.confirmedWeights(round).join(',') !== state.my_weights.join(','))) {
      journal.acceptSnapshot(round, state.my_total, journal.revision, state.my_weights);
    }
  }, [tab.owned,state.my_total, state.my_weights, state.round?.no, round, tick, cs.sentAt, journal]);
  useEffect(() => {
    if(!manualRun && state.prepared_run && state.prepared_run.status!=='closed' &&
      [...journal.pending,...journal.held.map(h=>h.action)].some(a=>a.recovery && a.runId===state.prepared_run!.id)){
      setManualRun(state.prepared_run);
      return;
    }
    // Keep a marshal-started round provisional through its end, including after
    // reconnect. Mixing accepted taps with earlier review taps makes weighted
    // Undo ambiguous. The next server-issued run returns to normal delivery.
    if (manualRun && !cs.cached && (state.prepared_run?.id !== manualRun.id || state.prepared_run.status === 'closed')) {
      setManualRun(null); store.del(`bos-counter-manual:${seatId}`);
      setNotice('The server moved on. Your offline evidence is kept for marshal review.');
    }
  }, [manualRun, cs.cached, state.prepared_run, state.can_count, seatId,journal,tick]);

  const manualAllowed = !!manualRun && state.prepared_run?.status !== 'closed' && (cs.cached || state.prepared_run?.id === manualRun.id);
  const canCount = tab.owned && (Boolean(state.can_count) && !cs.cached || manualAllowed) && !!run?.id && run.status!=='closed' && seat?.status === 'active' && !finishing.current;
  const canSubmit = !!manualRun || state.round?.no===round && state.round?.status!=='confirmed';
  const standing = state.counter_input === 'standing';
  const shown = round ? journal.display(round, run?.id) : 0;
  const left = standing ? standingLeft(state.per_side, shown) : null;
  const count = (weight: number) => {
    if (!canCount || !round) return;
    if (standing && left !== null && left <= 0) return;
    if (finishing.current) return;
    lastSendEnd.current = Date.now(); journal.add('tap', round, weight, { runId: run?.id, recovery: !!manualRun, recordedAt: new Date().toISOString(),operator:state.binding?.operator??seat?.operator,side:seat?.side??'',fighter:state.fighter??'',opponent:state.opponent??'' }); setNotice(null);
    try { navigator.vibrate?.(12); } catch { /* not supported */ }
    void pump();
  };
  const undo = () => {
    if (!canCount || !round || shown <= 0) return;
    if (finishing.current) return;
    lastSendEnd.current = Date.now(); journal.add('undo', round, 1, { runId: run?.id, recovery: !!manualRun, recordedAt: new Date().toISOString(),operator:state.binding?.operator??seat?.operator,side:seat?.side??'',fighter:state.fighter??'',opponent:state.opponent??'' });
    try { navigator.vibrate?.([8, 40, 8]); } catch { /* not supported */ }
    void pump();
  };
  const done = async () => {
    if (!seatId || !round || !tab.owned || finishing.current) return;
    finishing.current = true; setTick(t => t + 1);
    try {
      await journal.flush(send);
      lastSendEnd.current = Date.now(); setOffline(journal.offline);
      if (journal.pending.length > 0) { setNotice('Not sent yet. Your counts are kept here. Retry when connected, or show the saved evidence to the marshal.'); return; }
      if (journal.held.some(h => h.action.round === round && h.action.runId === run?.id)) { setNotice('This round has counts for marshal review. Show the saved evidence before submitting.'); return; }
      await counterSubmit(seatId, round); setNotice('Sent. Wait for the next round.'); void cs.refresh();
    } catch (e) { setNotice(friendlyError(e, 'Could not send. Your counts are kept here. Try again.')); }
    finally { finishing.current = false; setTick(t => t + 1); }
  };

  const now = useNow(state.timer?.status === 'running');
  const timeLeft = state.timer ? remainingMs(state.timer, cs.clock.now(now)) : 0;
  const waiting = journal.pending.length;
  const banner = useMemo(() => counterBanner({ seat: seat ? { status: seat.status, role: seat.role, side: seat.side } : null, can_count: state.can_count, final: state.final, waiting: state.waiting, round: state.round, counter_input: state.counter_input, binding: state.binding }, sides), [seat, state.can_count, state.final, state.waiting, state.round, state.counter_input, state.binding, sides]);
  const weighted = state.counter_input === 'weighted';
  const side = seat?.side ?? state.binding?.side ?? null;
  const operator = state.binding?.operator ?? seat?.operator ?? '';

  return (
    <main className={`cp${side ? ` cp-on-${side}` : ''}`} style={vars} aria-label={training ? 'Training counter' : 'Counter'}>
      <header className="cp-top">
        <div className="cp-who">
          <span className={`cp-badge${training ? ' is-learning' : ''}`}>{training ? 'Training' : 'Counting'}</span>
          {side && <span className={`cp-corner cp-corner-${side}`}>{sideLabel(side, sides).toUpperCase()}</span>}
          <span className="cp-lyst">{fieldLabel(state.field_label ?? seat?.field_key ?? '')}</span>
          <span className="cp-op" data-testid="cp-operator">{operator}</span>
        </div>
        {state.competition && <p className="src cp-ctx">{state.competition}{state.round_label ? ` · ${state.round_label}` : ''}</p>}
        {state.fighter ? <h1 className="cp-fighter" data-testid="cp-fighter">{state.fighter}</h1> : <h1 className="cp-fighter cp-fighter-wait">{state.field_label ? fieldLabel(state.field_label) : 'Your Lyst'}</h1>}
        {state.opponent && <p className="src cp-vs">vs {state.opponent}</p>}
        {state.fights && (state.fights.last || state.fights.now || state.fights.next) && (
          <dl className="cp-fights" data-testid="cp-fights" aria-label="This Lyst: last, now, next">
            <div><dt>Last fight</dt><dd data-testid="cp-fight-last">{fightLine(state.fights.last) ?? '—'}</dd></div>
            <div className="is-now"><dt>Now fighting</dt><dd data-testid="cp-fight-now">{fightLine(state.fights.now) ?? 'Nothing on yet'}</dd></div>
            <div><dt>Next fight</dt><dd data-testid="cp-fight-next">{fightLine(state.fights.next) ?? '—'}</dd></div>
          </dl>
        )}
        {state.timer && !state.waiting && <output className="cp-clock mono" aria-label={`Time left ${formatClock(timeLeft)}`}>{formatClock(timeLeft)}</output>}
        <p className={`cp-msg${offline || !canCount ? ' is-warn' : ''}`} role="status" aria-live="polite" data-testid="cp-banner">{banner}</p>
        {training && <p className="cp-msg" role="note">Practice: your count is kept for training and never changes any score.</p>}
        {training&&!!state.officials?.length&&<details className="panel info"><summary>Compare with official counters</summary><p className="src">Practice comparison for this side and round. Keep your own independent count.</p><ul>{state.officials.map((c,i)=><li key={`${c.name}:${i}`}>{c.name}: {c.total}</li>)}</ul></details>}
        {tab.status==='blocked' && <div className="cp-msg is-warn" role="alert">This counter is open in another tab. Close the other counter tab before counting here.<button type="button" className="btn btn-line" onClick={tab.retry}>Use this tab</button></div>}
        {tab.status==='unsupported' && !tab.owned && <div className="cp-msg is-warn" role="alert">This browser cannot check for another counter tab. Keep only one open and keep paper backup.<button type="button" className="btn btn-line" onClick={tab.acknowledgeSingleTab}>Only this counter tab is open · continue</button></div>}
        {offline && <p className="cp-msg is-warn" role="alert">No signal. {journal.durable ? 'Your taps are saved on this phone and will be retried.' : 'Your taps are in memory only. Keep a paper backup.'} They are not confirmed by the server yet.</p>}
        {!journal.durable && <p className="cp-msg is-warn" role="alert">This browser cannot safely save counts. Keep a paper count and show the saved evidence before leaving or reloading this screen.</p>}
        {cs.cacheFailed && <p className="cp-msg is-warn" role="alert">This phone could not save the fight and round for offline reopening. Keep this page open and keep paper backup.</p>}
        {notice && <p className="cp-msg is-warn" role="alert">{notice}</p>}
        {backlog && <p className="cp-msg is-warn" role="status">{backlog}</p>}
        {problem && <p className="cp-msg is-warn" role="alert">{problem}</p>}
        {cs.offline && !offline && <p className="cp-msg is-warn" role="status">Reconnecting…</p>}
        {cs.cached && <p className="cp-msg is-warn" role="alert">Saved fight from {new Date(state.server_now).toLocaleTimeString()}. Check the names, side and round with the marshal before counting offline.</p>}
        {manualRun && <p className="cp-msg is-warn" role="alert">Counting round {manualRun.no} from the marshal’s call. This is provisional evidence for review. It cannot change an official score.</p>}
        {tab.owned && !manualRun && !finishing.current && !busy && (!state.can_count || cs.cached) && seat?.status==='active' && state.prepared_run && state.prepared_run.status !== 'closed' && !state.waiting && !state.final && <div className="panel info">
          <p>Prepared round {state.prepared_run.no}: {state.fighter} vs {state.opponent}. If the marshal has called the start but this phone is still waiting, count here and show the evidence at the end.</p>
          <button type="button" className="btn btn-ink fq-big" onClick={() => {
            const prepared = state.prepared_run!;
            const saved=store.set(`bos-counter-manual:${seatId}`, JSON.stringify(prepared));
            setManualRun(prepared); setNotice(saved?'Listen to the marshal. This whole round stays marked for review.':'The offline-start choice could not be saved. Keep this page open and use paper backup. This round stays marked for review.');
          }}>Marshal started round {state.prepared_run.no} · count offline</button>
        </div>}
      </header>

      <section className="cp-main" aria-label="Count">
        {seat?.status === 'active' && round > 0 && !state.waiting && (
          standing
            ? <div className="cp-total" aria-live="off"><small>Round {round} · {sideLabel(side, sides)} standing</small><output aria-label={`${left} standing`} data-testid="cp-standing">{left}</output><small>{shown} down · of {state.per_side ?? 0}</small></div>
            : <div className="cp-total" aria-live="off"><small>Round {round} · your count</small><output aria-label={`Your count ${shown}`}>{shown}</output></div>
        )}
        {standing
          ? <button type="button" className="cp-count is-down" disabled={!canCount || (left !== null && left <= 0)} onClick={() => count(1)} aria-label="Fighter down">Fighter down</button>
          : weighted
            ? (
              <div className="cp-weighted">
                <button type="button" className="cp-count is-two" disabled={!canCount} onClick={() => count(2)} aria-label="Count two points, head or torso">+2</button>
                <button type="button" className="cp-count" disabled={!canCount} onClick={() => count(1)} aria-label="Count one point, arm leg or hand">+1</button>
              </div>)
            : <button type="button" className="cp-count" disabled={!canCount} onClick={() => count(1)} aria-label="Count">Count</button>}
      </section>

      <footer>
        <div className="cp-foot">
          <button type="button" className="btn btn-line" disabled={!canCount || shown <= 0} onClick={undo}>{standing ? 'Undo (back up)' : 'Undo last'}</button>
          <button type="button" className="btn btn-line" disabled={!tab.owned || !seat || seat.status !== 'active' || !round || !!state.waiting || finishing.current || !canSubmit} onClick={() => void done()}>{finishing.current?'Sending round…':'Done with round'}</button>
        </div>
        <p className="cp-sync" role="status">{waiting > 0 ? `${waiting} tap${waiting === 1 ? '' : 's'} ${journal.durable ? 'saved on this phone' : 'in memory only'}, waiting to send.` : journal.held.length ? `${journal.held.length} saved action${journal.held.length === 1 ? '' : 's'} kept as evidence.` : seat?.status === 'active' && !state.waiting ? 'All taps sent.' : ''}</p>
        <button type="button" className="ly-link" aria-expanded={backup} onClick={() => setBackup(v => !v)}>Saved count evidence</button>
        {backup && <label className="field-in">Copy or photograph this for the marshal. It includes pending and refused counts; it does not change the official result.<textarea readOnly value={journal.export()} rows={8} aria-label="Saved count evidence" /></label>}
        {backup&&tab.owned&&journal.held.some(h=>!h.delivered&&!h.archivedAt)&&<button type="button" className="ly-link" onClick={()=>{
          const saved=journal.archiveShownEvidence(new Set(journal.held.filter(h=>!h.delivered).map(h=>h.action.id)));
          setNotice(saved?'Held counts archived locally after your marshal handoff. The actions are kept; pending taps and official scores have not changed.':'The archive could not be saved. Keep this page open and keep your copy.');
        }}>I showed the held counts to the marshal · archive on this phone</button>}
        <nav className="cp-links" aria-label="Change">
          <button type="button" className="ly-link" disabled={busy} onClick={onChangeOperator}>{training ? 'Change name' : 'New counter'}</button>
          {onChangeSide && <button type="button" className="ly-link" disabled={busy} onClick={onChangeSide}>Change side</button>}
          {onChangeField && <button type="button" className="ly-link" disabled={busy} onClick={onChangeField}>Change Lyst</button>}
          <button type="button" className="ly-link" disabled={busy} onClick={() => void onLeave()}>{training ? 'Leave' : 'Stop counting'}</button>
        </nav>
        {training && state.event && <Link className="ly-link" to={`/events/${state.event.slug}`}>Back to the event</Link>}
      </footer>
    </main>
  );
}
