import { useState } from 'react';
import { Dialog } from '../Dialog';
import { saveLystSettings } from '../../data/lyst';
import { friendlyError } from '../../lib/friendlyError';
import type { LystSettings } from '../../lib/lyst/rounds';

const KINDS = [['fight', 'Round'], ['break', 'Break'], ['extended_break', 'Long break'], ['dq', 'DQ countdown'], ['equipment', 'Equipment']] as const;
const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'card';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const parse = (v: string): number | null => { const m = /^(\d{1,2}):([0-5]\d)$/.exec(v.trim()); if (m) return Number(m[1]) * 60 + Number(m[2]); return /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : null; };

/** Every number a ruleset might change is here: the durations, the regular rounds, the card names and the allowed deductions. Starting values only; nothing is invented. */
export function LystSettingsDialog({ eventId, settings, onClose, onSaved }: { eventId: string; settings: LystSettings; onClose: () => void; onSaved: () => void }) {
  const [times, setTimes] = useState<Record<string, string>>(() => Object.fromEntries(KINDS.map(([k]) => [k, mmss(settings.presets.find(p => p.kind === k)?.seconds ?? 60)])));
  const [regular, setRegular] = useState(String(settings.regular_rounds));
  const [extra, setExtra] = useState(mmss(settings.extra_round_seconds));
  const [autoBreak, setAutoBreak] = useState(settings.auto_break);
  const [input, setInput] = useState(settings.counter_input);
  const [cards, setCards] = useState(settings.cards.map(c => c.label).join('\n'));
  const [amounts, setAmounts] = useState(settings.deduction_amounts.join(', '));
  const [reasons, setReasons] = useState(settings.reasons.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const presets = [];
    for (const [kind, label] of KINDS) {
      const s = parse(times[kind]);
      if (s === null || s < 1 || s > 3600) { setError(`${label}: use minutes and seconds like 1:00.`); return; }
      presets.push({ key: kind, label, seconds: s, kind });
    }
    const x = parse(extra), r = Number(regular);
    if (x === null || x < 1 || x > 3600) { setError('Extra round: use minutes and seconds like 0:30.'); return; }
    if (!Number.isInteger(r) || r < 1 || r > 20) { setError('Regular rounds: a whole number from 1 to 20.'); return; }
    const nums = amounts.split(/[,\s]+/).filter(Boolean).map(Number);
    if (nums.length < 1 || nums.length > 6 || nums.some(n => !Number.isInteger(n) || n < 1 || n > 10)) { setError('Deduction amounts: 1 to 6 whole numbers between 1 and 10, like 1, 2, 3.'); return; }
    const cardList = cards.split('\n').map(c => c.trim()).filter(Boolean);
    if (cardList.length > 8 || cardList.some(c => c.length > 30)) { setError('Cards: at most 8, each up to 30 characters.'); return; }
    const reasonList = reasons.split('\n').map(c => c.trim()).filter(Boolean);
    if (reasonList.length > 12 || reasonList.some(c => c.length > 40)) { setError('Reasons: at most 12, each up to 40 characters.'); return; }
    setBusy(true);
    try {
      await saveLystSettings(eventId, { presets, regular_rounds: r, extra_round_seconds: x, auto_break: autoBreak, counter_input: input, deduction_amounts: nums, cards: cardList.map(label => ({ key: keyOf(label), label })), reasons: reasonList });
      onSaved(); onClose();
    } catch (e) { setError(friendlyError(e, 'Could not save the settings.')); } finally { setBusy(false); }
  };

  return (
    <Dialog title="Lyst settings" variant="drawer" onClose={onClose} busy={busy}>
      <div className="ly-settings">
        <p className="src">These are starting values. Set what your ruleset says; nothing here is a rule of BuhurtOS.</p>
        <fieldset><legend>Clock lengths (M:SS)</legend>
          <div className="ly-set-grid">{KINDS.map(([k, label]) => <label key={k}><span>{label}</span><input inputMode="numeric" value={times[k]} onChange={e => setTimes({ ...times, [k]: e.target.value })} /></label>)}</div>
        </fieldset>
        <fieldset><legend>Rounds</legend>
          <div className="ly-set-grid">
            <label><span>Regular rounds</span><input inputMode="numeric" value={regular} onChange={e => setRegular(e.target.value)} /></label>
            <label><span>Extra round length</span><input inputMode="numeric" value={extra} onChange={e => setExtra(e.target.value)} /></label>
          </div>
          <label className="ly-check"><input type="checkbox" checked={autoBreak} onChange={e => setAutoBreak(e.target.checked)} /> Start the break by itself when the round clock reaches zero (on the operating tablet)</label>
        </fieldset>
        <fieldset><legend>Counters tap</legend>
          <div className="ly-chips" role="group" aria-label="Counter buttons">
            {(['auto', 'simple', 'weighted'] as const).map(v => <button key={v} type="button" className="ly-chip" aria-pressed={input === v} onClick={() => setInput(v)}>{v === 'auto' ? 'By category' : v === 'simple' ? 'One tap per strike' : '+2 and +1 buttons'}</button>)}
          </div>
        </fieldset>
        <fieldset><legend>Cards (one per line; leave empty if your ruleset has none)</legend>
          <textarea rows={3} value={cards} onChange={e => setCards(e.target.value)} placeholder="Type the card names your ruleset uses" />
        </fieldset>
        <label><span>Point deductions the marshal may choose</span><input value={amounts} onChange={e => setAmounts(e.target.value)} /></label>
        <fieldset><legend>Reasons offered (one per line)</legend><textarea rows={4} value={reasons} onChange={e => setReasons(e.target.value)} /></fieldset>
        {error && <p role="alert" className="ly-error">{error}</p>}
        <button type="button" className="btn btn-win fq-big" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </Dialog>
  );
}
