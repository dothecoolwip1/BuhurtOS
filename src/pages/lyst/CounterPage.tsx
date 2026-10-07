import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { SignIn } from '../../auth/SignIn';
import { counterBind, counterLeave, counterRecord, counterSetOperator, counterSubmit, counterUndo, joinTrainingCounter, leaveSeat, type CounterField, type CounterState } from '../../data/lyst';
import { deviceManager, isDeviceMode, storedWhoami } from '../../lib/deviceSession';
import { Dialog } from '../../components/Dialog';
import { classifyRpcError } from '../../lib/scoreSender';
import { fieldLabel } from '../../lib/eventDay';
import { friendlyError } from '../../lib/friendlyError';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { DEFAULT_SIDES, EXIT_PATH, TapQueue, counterBanner, dropStaleQueues, fightLine, flushTaps, mergeSides, nextStep, onlyField, parseJoinCode, rememberOperator, rememberedOperator, sideLabel, sideVars, standingLeft, tapsKey, type CountAction, type CounterSend, type CounterStep } from '../../lib/lyst/counters';
import { formatClock, remainingMs } from '../../lib/lyst/timer';
import { useCounterState, useNow } from '../../lib/lyst/useLystState';

const TRAIN_CODE_KEY = 'bos-lyst-train-code';
const local = () => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* the taps still work for this session */ } },
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
    rememberOperator(local(), operator);   // offered again on this phone's next scan: a name, never a sign-in
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
  // Exit Counter: this phone stops being event equipment. Its place on the Lyst ends (evidence kept), the session is signed out, and the phone goes
  // back to the ordinary site. A person's own account, if one was signed in before the scan, is untouched: it lived under its own key all along.
  const exit = async () => {
    setBusy(true);
    try { await counterLeave(); } catch { /* the server ends the binding with the session anyway */ }
    dropStaleQueues(local(), null);
    await deviceManager().signOut(EXIT_PATH);
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
        <OperatorForm initial={binding?.operator ?? rememberedOperator(local())} busy={busy} problem={problem} onSave={saveOperator} onCancel={editing && binding?.operator ? () => setEditing(null) : undefined} />
      </main>
    );
  }
  if (step === 'field') {
    return (
      <main className="cp cp-setup" style={vars} aria-label="Which Lyst">
        {head}
        <h1 className="cp-q">Choose your Lyst</h1>
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
        <h1 className="cp-q">Choose your side on {whichLyst}</h1>
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
    <CountScreen state={state!} cs={cs} training={false} busy={busy} problem={problem}
      onChangeOperator={() => setEditing('operator')} onChangeSide={() => setEditing('side')} onChangeField={fields.length > 1 ? () => setEditing('field') : undefined}
      onLeave={exit} />
  );
}

function FieldButton({ f, current, onPick, busy }: { f: CounterField; current: boolean; onPick: () => void; busy: boolean }) {
  return (
    <button type="button" className="cp-choice" disabled={busy} onClick={onPick} aria-pressed={current}>
      <b>{fieldLabel(f.label)}</b><span className="src" data-testid="cp-field-now">{f.now ? `${f.now.a ?? 'Side A'} vs ${f.now.b ?? 'Side B'}` : f.open ? 'A fight is open here' : 'No fight open yet'}{current ? ' · your Lyst now' : ''}</span>
    </button>
  );
}

function OperatorForm({ initial, busy, problem, onSave, onCancel, title = "Who's counting?" }: { initial: string; busy: boolean; problem: string | null; onSave: (name: string) => unknown; onCancel?: () => void; title?: string }) {
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
          <h1 className="cp-q">Who's counting?</h1>
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
    <CountScreen state={state} cs={cs} training busy={busy} problem={problem} onChangeOperator={() => setRenaming(true)}
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
  const round = state.round?.no ?? 0;
  const seatId = seat?.id ?? '';
  const [notice, setNotice] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [tick, setTick] = useState(0);
  const [serverTotal, setServerTotal] = useState(0);
  const [offline, setOffline] = useState(false);
  const queue = useRef(new TapQueue());
  const pumping = useRef(false);
  const lastSendEnd = useRef(0);

  // the phone's own queue survives a refresh (keyed by the seat: a new fight is a new seat and starts clean)
  useEffect(() => {
    if (!seatId) return;
    const raw = store.get(tapsKey(seatId));
    try { queue.current.load(raw ? (JSON.parse(raw) as CountAction[]) : []); } catch { queue.current.load([]); }
    // queues of fights this phone is no longer on can never count: they go, and the phone says so once if anything was still waiting in them
    const gone = dropStaleQueues(local(), seatId);
    if (gone > 0) setNotice(`${gone} tap${gone === 1 ? '' : 's'} from an earlier fight ${gone === 1 ? 'was' : 'were'} still waiting on this phone and ${gone === 1 ? 'was' : 'were'} not counted.`);
    setServerTotal(0); setTick(t => t + 1);
  }, [seatId]);
  const persist = useCallback(() => { if (seatId) store.set(tapsKey(seatId), JSON.stringify(queue.current.pending)); }, [seatId]);

  const send: CounterSend = useCallback(async a => {
    try {
      const r = a.kind === 'tap' ? await counterRecord(a.id, seatId, a.round, a.weight) : await counterUndo(a.id, seatId, a.round);
      return { status: r.status, total: r.total };
    } catch (e) {
      const c = classifyRpcError(e);
      if (c === 'offline' || c === 'retry') return { status: 'offline' as const };
      const message = (e as { message?: string } | null)?.message ?? '';
      const reason = /ROUND_ENDED/.test(message) ? 'ROUND_ENDED' : /ROUND_CHANGED/.test(message) ? 'ROUND_CHANGED' : /ROUND_NOT_STARTED|WAITING_FOR_FIGHT/.test(message) ? 'ROUND_NOT_STARTED' : 'OTHER';
      return { status: 'refused' as const, reason, message };
    }
  }, [seatId]);

  const pump = useCallback(async () => {
    if (pumping.current || !seatId) return;
    pumping.current = true;
    try {
      const r = await flushTaps(queue.current, send);
      if (r.total !== null) setServerTotal(r.total);
      setOffline(r.stopped === 'offline');
      if (r.stopped === 'refused') setNotice(/already down/i.test(r.refusal ?? '') ? 'Everyone on that side is already down.' : 'The round had already ended, so your last taps were not counted. Tell the Lyst if that looks wrong.');
      persist(); setTick(t => t + 1);
      if (r.sent > 0 || r.stopped !== 'empty') lastSendEnd.current = Date.now();
      if (r.stopped === 'empty') void cs.refresh();
    } finally { pumping.current = false; }
  }, [seatId, send, persist, cs]);

  useEffect(() => {
    const id = window.setInterval(() => { if (queue.current.size > 0) void pump(); }, 3000);
    const on = () => { void pump(); };
    window.addEventListener('online', on);
    return () => { window.clearInterval(id); window.removeEventListener('online', on); };
  }, [pump]);
  // the server's total is the truth when nothing is waiting, but only from an answer requested after our last send
  useEffect(() => { if (state.my_total !== undefined && queue.current.size === 0 && !pumping.current && cs.sentAt > lastSendEnd.current) setServerTotal(state.my_total); }, [state.my_total, tick, cs.sentAt]);   // eslint-disable-line react-hooks/exhaustive-deps
  const lastRound = useRef(round);
  useEffect(() => { if (lastRound.current !== round) { const gone = queue.current.dropRound(lastRound.current); lastRound.current = round; if (gone.length) { setNotice('The round changed, so taps that were still waiting were not counted.'); persist(); } setTick(t => t + 1); } }, [round, persist]);

  const canCount = Boolean(state.can_count) && seat?.status === 'active';
  const standing = state.counter_input === 'standing';
  const shown = round ? queue.current.display(serverTotal, round) : 0;
  const left = standing ? standingLeft(state.per_side, shown) : null;
  const count = (weight: number) => {
    if (!canCount || !round) return;
    if (standing && left !== null && left <= 0) return;
    queue.current.tap(round, weight); persist(); setTick(t => t + 1); setNotice(null);
    try { navigator.vibrate?.(12); } catch { /* not supported */ }
    void pump();
  };
  const undo = () => {
    if (!canCount || !round || shown <= 0) return;
    queue.current.undo(round); persist(); setTick(t => t + 1);
    try { navigator.vibrate?.([8, 40, 8]); } catch { /* not supported */ }
    void pump();
  };
  const done = async () => { if (!seatId || !round) return; try { await pump(); await counterSubmit(seatId, round); setNotice('Sent. Wait for the next round.'); void cs.refresh(); } catch (e) { setNotice(friendlyError(e, 'Could not send. Try again.')); } };

  const now = useNow(state.timer?.status === 'running');
  const timeLeft = state.timer ? remainingMs(state.timer, cs.clock.now(now)) : 0;
  const waiting = queue.current.size;
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
        {offline && <p className="cp-msg is-warn" role="alert">No signal. Keep tapping: your taps are saved on this phone and will be sent. They are not counted yet.</p>}
        {notice && <p className="cp-msg is-warn" role="alert">{notice}</p>}
        {problem && <p className="cp-msg is-warn" role="alert">{problem}</p>}
        {cs.offline && !offline && <p className="cp-msg is-warn" role="status">Reconnecting…</p>}
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
          <button type="button" className="btn btn-line" disabled={!seat || seat.status !== 'active' || !round || !!state.waiting || !!state.submitted} onClick={() => void done()}>{state.submitted ? `Round ${round} sent ✓` : 'Done with round'}</button>
        </div>
        <p className="cp-sync" role="status">{waiting > 0 ? `${waiting} tap${waiting === 1 ? '' : 's'} saved on this phone, sending…` : seat?.status === 'active' && !state.waiting ? 'All taps sent.' : ''}</p>
        <nav className="cp-links" aria-label="Change">
          <button type="button" className="ly-link" disabled={busy} onClick={onChangeOperator}>{training ? 'Change name' : 'Change counter'}</button>
          {onChangeSide && <button type="button" className="ly-link" disabled={busy} onClick={onChangeSide}>Change side</button>}
          {onChangeField && <button type="button" className="ly-link" disabled={busy} onClick={onChangeField}>Change Lyst</button>}
          {training
            ? <button type="button" className="ly-link" disabled={busy} onClick={() => void onLeave()}>Leave</button>
            : <button type="button" className="ly-link" disabled={busy} onClick={() => setLeaving(true)}>Exit Counter</button>}
        </nav>
        {training && state.event && <Link className="ly-link" to={`/events/${state.event.slug}`}>Back to the event</Link>}
      </footer>
      {leaving && (
        <Dialog title="Exit Counter?" variant="drawer" busy={busy} onClose={() => setLeaving(false)}>
          <p style={{ marginTop: 0 }}>This phone stops counting{waiting > 0 ? ` (${waiting} tap${waiting === 1 ? '' : 's'} not sent yet would be lost)` : ''} and goes back to the ordinary BuhurtOS site. Your counts so far stay with the fight. To count again, scan the Counter QR.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            <button type="button" className="btn btn-ink" data-autofocus disabled={busy} onClick={() => void onLeave()} data-testid="cp-exit">Yes, exit Counter</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setLeaving(false)}>Keep counting</button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
