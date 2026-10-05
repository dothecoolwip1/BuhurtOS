import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { SignIn } from '../../auth/SignIn';
import { counterRecord, counterSubmit, counterUndo, requestSeat, leaveSeat } from '../../data/lyst';
import { classifyRpcError } from '../../lib/scoreSender';
import { friendlyError } from '../../lib/friendlyError';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { TapQueue, counterBanner, flushTaps, parseJoinCode, type CountAction, type CounterSend } from '../../lib/lyst/counters';
import { formatClock, remainingMs } from '../../lib/lyst/timer';
import { useCounterState, useNow } from '../../lib/lyst/useLystState';

const CODE_KEY = 'bos-lyst-code';
const tapsKey = (seat: string) => `bos-lyst-taps:${seat}`;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* the taps still work for this session */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } }
};

/**
 * The counter's phone. A counter taps COUNT for every valid strike the tablet's lyst assigned them to watch. What they tally is PROVISIONAL evidence for the marshal:
 * it never becomes a score by itself. Every tap is saved on the phone first, carries its own id, and is sent in order, so a lost signal, a refresh or a double send can
 * neither lose a tap nor count it twice. A learning counter sees the same screen: practice, with no effect on anything official.
 */
export function CounterPage() {
  useDocumentTitle('Counter');
  const { code: urlCode } = useParams();
  const nav = useNavigate();
  const { session, loading } = useAuth();
  const userId = session?.user.id ?? '';
  const code = parseJoinCode(urlCode) ?? parseJoinCode(store.get(CODE_KEY));
  const cs = useCounterState(Boolean(session), userId);
  const state = cs.state;
  const [typed, setTyped] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [serverTotal, setServerTotal] = useState(0);
  const [offline, setOffline] = useState(false);
  const queue = useRef(new TapQueue());
  const pumping = useRef(false);
  const lastSendEnd = useRef(0);   // when the phone last finished talking to the server about taps
  const requested = useRef<string | null>(null);
  const seat = state?.seat ?? null;
  const round = state?.round?.no ?? 0;
  const seatId = seat?.id ?? '';

  // join: remember the code across a sign-in redirect, ask for the seat once, then the page follows the state
  useEffect(() => {
    if (urlCode && parseJoinCode(urlCode)) store.set(CODE_KEY, parseJoinCode(urlCode)!);
  }, [urlCode]);
  useEffect(() => {
    if (!session || !code || requested.current === code || (seat && seat.status !== 'ended' && seat.status !== 'declined')) return;
    requested.current = code;
    void requestSeat(code).then(r => {
      if (r.status === 'invalid') { setJoinError(r.message ?? 'That join code is not valid.'); store.del(CODE_KEY); return; }
      store.del(CODE_KEY); setJoinError(null); void cs.refresh();
      if (urlCode) nav('/lyst/counter', { replace: true });
    }).catch(e => setJoinError(friendlyError(e, 'Could not join. Check your signal and scan again.')));
  }, [session, code, seat, urlCode, nav, cs]);

  // the phone's own queue survives a refresh
  useEffect(() => {
    if (!seatId) return;
    const raw = store.get(tapsKey(seatId));
    try { if (raw) queue.current.load(JSON.parse(raw) as CountAction[]); } catch { /* start empty */ }
    setTick(t => t + 1);
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
      const reason = /ROUND_ENDED/.test(message) ? 'ROUND_ENDED' : /ROUND_CHANGED/.test(message) ? 'ROUND_CHANGED' : /ROUND_NOT_STARTED/.test(message) ? 'ROUND_NOT_STARTED' : 'OTHER';
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
      if (r.stopped === 'refused') setNotice('The round had already ended, so your last taps were not counted. Tell the lyst if that looks wrong.');
      persist(); setTick(t => t + 1);
      if (r.sent > 0 || r.stopped !== 'empty') lastSendEnd.current = Date.now();
      if (r.stopped === 'empty') void cs.refresh();
    } finally { pumping.current = false; }
  }, [seatId, send, persist, cs]);

  // retry whatever is waiting while the signal is back
  useEffect(() => {
    const id = window.setInterval(() => { if (queue.current.size > 0) void pump(); }, 3000);
    const on = () => { void pump(); };
    window.addEventListener('online', on);
    return () => { window.clearInterval(id); window.removeEventListener('online', on); };
  }, [pump]);

  // the server's total is the truth when nothing is waiting
  // ... but only an answer that was REQUESTED after our last tap was sent: one already in flight would put an old count back on screen
  useEffect(() => { if (state?.my_total !== undefined && queue.current.size === 0 && !pumping.current && cs.sentAt > lastSendEnd.current) setServerTotal(state.my_total); }, [state?.my_total, tick, cs.sentAt]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a new round: nothing waiting for the old one can ever count
  const lastRound = useRef(round);
  useEffect(() => { if (lastRound.current !== round) { const gone = queue.current.dropRound(lastRound.current); lastRound.current = round; if (gone.length) { setNotice('The round changed, so taps that were still waiting were not counted.'); persist(); } setTick(t => t + 1); } }, [round, persist]);

  const canCount = Boolean(state?.can_count) && seat?.status === 'active';
  const count = (weight: number) => {
    if (!canCount || !round) return;
    queue.current.tap(round, weight); persist(); setTick(t => t + 1); setNotice(null);
    try { navigator.vibrate?.(12); } catch { /* not supported */ }
    void pump();
  };
  const undo = () => {
    if (!canCount || !round || queue.current.display(serverTotal, round) <= 0) return;
    queue.current.undo(round); persist(); setTick(t => t + 1);
    try { navigator.vibrate?.([8, 40, 8]); } catch { /* not supported */ }
    void pump();
  };
  const done = async () => { if (!seatId || !round) return; try { await pump(); await counterSubmit(seatId, round); setNotice('Sent. Wait for the next round.'); void cs.refresh(); } catch (e) { setNotice(friendlyError(e, 'Could not send. Try again.')); } };
  const leave = async () => { if (!seatId) return; try { await leaveSeat(seatId); store.del(tapsKey(seatId)); void cs.refresh(); } catch (e) { setNotice(friendlyError(e)); } };

  const now = useNow(state?.timer?.status === 'running');
  const left = state?.timer ? remainingMs(state.timer, cs.clock.now(now)) : 0;
  const shown = round ? queue.current.display(serverTotal, round) : 0;
  const waiting = queue.current.size;
  const banner = useMemo(() => (state ? counterBanner({ seat: seat ? { status: seat.status, role: seat.role } : null, can_count: state.can_count, final: state.final, round: state.round }) : 'Loading…'), [state, seat]);
  const learning = seat?.role === 'learning';
  const weighted = state?.counter_input === 'weighted';

  if (loading) return <main className="cp"><p className="muted">Loading…</p></main>;
  if (!session) {
    return (
      <main className="cp-join">
        <h1>Counter</h1>
        <p>Sign in so the lyst knows who you are. You count strikes for one fighter; the marshal makes the call.</p>
        <SignIn reason="Sign in to count for a fight." />
      </main>
    );
  }
  if (!seat && !code) {
    return (
      <main className="cp-join">
        <h1>Join as a counter</h1>
        <p>Scan the QR code on the lyst tablet, or type its code.</p>
        <label htmlFor="cp-code" className="sr-only">Join code</label>
        <input id="cp-code" className="cp-code-in" value={typed} maxLength={14} autoCapitalize="characters" autoComplete="off" onChange={e => setTyped(e.target.value)} placeholder="CODE" />
        <button type="button" className="btn btn-ink fq-big" disabled={!parseJoinCode(typed)} onClick={() => nav(`/lyst/join/${parseJoinCode(typed)}`)}>Join</button>
        {joinError && <p role="alert" className="ly-error">{joinError}</p>}
      </main>
    );
  }
  if (joinError && !seat) {
    return (
      <main className="cp-join">
        <h1>Could not join</h1>
        <p role="alert" className="ly-error">{joinError}</p>
        <button type="button" className="btn btn-ink fq-big" onClick={() => { setJoinError(null); requested.current = null; store.del(CODE_KEY); nav('/lyst/join', { replace: true }); }}>Type a new code</button>
      </main>
    );
  }

  return (
    <main className="cp" aria-label="Counter">
      <header className="cp-top">
        <div className="cp-who">
          {seat?.slot && <span className={`cp-badge${learning ? ' is-learning' : ''}`}>{learning ? 'Learning' : 'Counting'} · {seat.slot}</span>}
          {state?.competition && <span className="src">{state.competition} · {state.round_label}</span>}
        </div>
        {state?.fighter && <h1 className="cp-fighter">{state.fighter}</h1>}
        {state?.timer && <output className="cp-clock mono" aria-label={`Time left ${formatClock(left)}`}>{formatClock(left)}</output>}
        <p className={`cp-msg${offline || !canCount ? ' is-warn' : ''}`} role="status" aria-live="polite">{banner}</p>
        {learning && <p className="cp-msg" role="note">Practice seat: your count is kept for training and never changes any score.</p>}
        {offline && <p className="cp-msg is-warn" role="alert">No signal. Keep tapping: your taps are saved on this phone and will be sent. They are not counted yet.</p>}
        {notice && <p className="cp-msg is-warn" role="alert">{notice}</p>}
        {cs.offline && !offline && <p className="cp-msg is-warn" role="status">Reconnecting…</p>}
      </header>

      <section className="cp-main" aria-label="Count">
        {seat?.status === 'active' && round > 0 && (
          <div className="cp-total" aria-live="off"><small>Round {round} · your count</small><output aria-label={`Your count ${shown}`}>{shown}</output></div>
        )}
        {weighted
          ? (
            <div className="cp-weighted">
              <button type="button" className="cp-count is-two" disabled={!canCount} onClick={() => count(2)} aria-label="Count two points, head or torso">+2</button>
              <button type="button" className="cp-count" disabled={!canCount} onClick={() => count(1)} aria-label="Count one point, arm leg or hand">+1</button>
            </div>)
          : <button type="button" className="cp-count" disabled={!canCount} onClick={() => count(1)} aria-label="Count">Count</button>}
      </section>

      <footer>
        <div className="cp-foot">
          <button type="button" className="btn btn-line" disabled={!canCount || shown <= 0} onClick={undo}>Undo last</button>
          <button type="button" className="btn btn-line" disabled={!seat || seat.status !== 'active' || !round} onClick={() => void done()}>Done with round</button>
        </div>
        <p className="cp-sync" role="status">{waiting > 0 ? `${waiting} tap${waiting === 1 ? '' : 's'} saved on this phone, sending…` : seat?.status === 'active' ? 'All taps sent.' : ''}</p>
        {seat && <button type="button" className="ly-link" onClick={() => void leave()}>Leave this seat</button>}
      </footer>
    </main>
  );
}
