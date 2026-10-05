import { useState } from 'react';
import { MODE_LABEL, formatClock, timerTone, timerWord, type LystTimer, type TimerMode, type TimerPreset } from '../../lib/lyst/timer';

export interface TimerSend { (action: 'set' | 'start' | 'pause' | 'resume' | 'reset' | 'adjust' | 'restore', o?: { mode?: TimerMode; durationMs?: number; round?: number; deltaMs?: number }): void }

const ARM_MODES: TimerMode[] = ['fight', 'break', 'extended_break', 'dq', 'equipment', 'custom'];

/**
 * The lyst clock. It shows server state (the parent derives `leftMs` from the measured server clock) and every button is one server command: nothing is counted here.
 * The clock is NOT controllable without signal: the buttons are disabled and say why, so nobody believes a command went through when it did not.
 */
export function TimerBar({ timer, leftMs, roundNo, presets, busy, offline, note, onSend, startHere }: {
  timer: LystTimer | null; leftMs: number; roundNo: number; presets: readonly TimerPreset[]; busy: boolean; offline: boolean; note: string | null; onSend: TimerSend;
  /** Show this bar's own Start button for an idle clock (the round zone has its own big button for rounds and breaks, so it is hidden then). */
  startHere: boolean;
}) {
  const [more, setMore] = useState(false);
  const [custom, setCustom] = useState('2:30');
  const mode: TimerMode = timer?.mode ?? 'fight';
  const status = timer?.status ?? 'idle';
  const tone = timer ? timerTone(timer, leftMs) : 'calm';
  const disabled = busy || offline;
  const presetSeconds = (m: TimerMode) => presets.find(p => p.kind === m)?.seconds;
  const parseClock = (v: string): number | null => { const m = /^(\d{1,2}):([0-5]\d)$/.exec(v.trim()); if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000; const n = /^(\d{1,4})$/.exec(v.trim()); return n ? Number(n[1]) * 1000 : null; };
  const customMs = parseClock(custom);

  return (
    <section className={`ly-timer is-${tone} is-${status}`} aria-label="Lyst clock">
      <div className="ly-clock-row">
        <div className="ly-clock-meta">
          <span className="ly-mode">{mode === 'fight' ? `Round ${timer?.round_no ?? roundNo}` : mode === 'break' || mode === 'extended_break' ? `${MODE_LABEL[mode]} after round ${timer?.round_no ?? roundNo}` : MODE_LABEL[mode]}</span>
          <span className="ly-word" role="status" aria-live="polite">{timer ? timerWord(timer, leftMs) : 'Clock ready'}</span>
        </div>
        <output className="ly-clock mono" aria-label={`Time left ${formatClock(leftMs)}`}>{formatClock(leftMs)}</output>
      </div>
      <div className="ly-timer-actions">
        {status === 'running'
          ? <button type="button" className="btn btn-ink ly-btn" disabled={disabled} onClick={() => onSend('pause')}>Pause</button>
          : status === 'paused'
            ? <button type="button" className="btn btn-win ly-btn" disabled={disabled} onClick={() => onSend('resume')}>Resume</button>
            : startHere
              ? <button type="button" className="btn btn-win ly-btn" disabled={disabled} onClick={() => onSend('start', { mode, round: timer?.round_no ?? roundNo, durationMs: timer?.duration_ms })}>Start {MODE_LABEL[mode].toLowerCase()}</button>
              : <span aria-hidden="true" />}
        <button type="button" className="btn btn-line ly-btn" aria-expanded={more} onClick={() => setMore(v => !v)}>{more ? 'Less' : 'Clock options'}</button>
      </div>
      {offline && <p className="ly-note" role="alert">No signal: the clock keeps running on the server, but it cannot be changed from this device until you are back online.</p>}
      {note && !offline && <p className="ly-note" role="status">{note}</p>}
      {more && (
        <div className="ly-timer-more">
          <div className="ly-seg" role="group" aria-label="Which clock">
            {ARM_MODES.filter(m => m !== 'custom').map(m => (
              <button key={m} type="button" className="ly-chip" aria-pressed={mode === m && status === 'idle'} disabled={disabled || status === 'running'}
                onClick={() => onSend('set', { mode: m, durationMs: (presetSeconds(m) ?? 60) * 1000, round: timer?.round_no ?? roundNo })}>{MODE_LABEL[m]} {formatClock((presetSeconds(m) ?? 60) * 1000)}</button>
            ))}
          </div>
          <div className="ly-adjust" role="group" aria-label="Adjust the clock">
            {[-5000, -1000, 1000, 5000].map(d => <button key={d} type="button" className="btn btn-line" disabled={disabled || status === 'idle'} onClick={() => onSend('adjust', { deltaMs: d })}>{d > 0 ? '+' : '−'}{Math.abs(d) / 1000} s</button>)}
          </div>
          <div className="ly-custom">
            <label htmlFor="ly-custom">Custom time (M:SS)</label>
            <input id="ly-custom" inputMode="numeric" value={custom} onChange={e => setCustom(e.target.value)} aria-invalid={customMs === null} />
            <button type="button" className="btn btn-line" disabled={disabled || customMs === null || status === 'running' || customMs < 1000 || customMs > 3_600_000} onClick={() => customMs && onSend('set', { mode: 'custom', durationMs: customMs, round: timer?.round_no ?? roundNo })}>Set</button>
          </div>
          <div className="ly-timer-actions">
            <button type="button" className="btn btn-line ly-btn" disabled={disabled} onClick={() => onSend('reset')}>Reset clock</button>
            <button type="button" className="btn btn-line ly-btn" disabled={disabled || !timer?.can_restore} onClick={() => onSend('restore')}>Undo last clock change</button>
          </div>
        </div>
      )}
    </section>
  );
}
