import { useMemo, useState } from 'react';
import { Dialog } from '../Dialog';
import { BAND_LABEL, CRITERION_LABEL, criteriaToAsk, needsCriteria, sheetResult, type Call, type CriteriaCalls } from '../../lib/outrance';
import { MARKS, type Tally } from '../../lib/lyst/lineMarshal';

const ROW: Record<(typeof MARKS)[number], string> = { strike: 'Effective strikes', takedown: 'Effective takedowns', weapon_loss: 'Loss of weapon', armour_failure: 'Armour failures' };
import type { EventSides } from '../../lib/lyst/counters';

/**
 * The line marshal hands in the round's sheet (Outrance §15, the p.25 sheet). The phone shows the marshal's own totals; when the strike point
 * difference is 5 or less it asks the other criteria one at a time, in priority order, and stops at the first that is not Even (§15.2). The
 * server takes every total from the phone's taps; only the criteria are sent from here. Deductions (cards, armour grants, 3+ weapon losses) are
 * applied by the secretary from the protocol and this sheet.
 */
export function OutranceSheetDialog({ round, tally, names, sides, busy, message, onSubmit, onClose }: {
  round: number; tally: Tally; names: { a: string; b: string }; sides: EventSides; busy: boolean; message: string | null;
  onSubmit: (calls: CriteriaCalls) => void; onClose: () => void;
}) {
  const [calls, setCalls] = useState<CriteriaCalls>({});
  const even = needsCriteria(tally.strike);
  const ask = even ? criteriaToAsk(calls) : [];
  const preview = useMemo(() => sheetResult(tally.strike, even ? calls : {}), [tally.strike, calls, even]);
  const ready = ask.length === 0;
  const who = (s: 'a' | 'b') => `${sides[s].name} · ${names[s]}`;
  const answer = (c: Call) => { const k = ask[0]; if (k) setCalls(v => ({ ...v, [k]: c })); };
  return (
    <Dialog title={`Round ${round} · your sheet`} onClose={onClose} busy={busy} dismissOnBackdrop={false}>
      <table className="om-sheet" aria-label={`Your round ${round} sheet`}>
        <thead><tr><th scope="col"></th><th scope="col" className="om-a">{sides.a.name}</th><th scope="col" className="om-b">{sides.b.name}</th></tr></thead>
        <tbody>
          {MARKS.map(m => <tr key={m}><th scope="row">{ROW[m]}</th><td className="mono">{tally[m].a}</td><td className="mono">{tally[m].b}</td></tr>)}
        </tbody>
      </table>
      {!even && <p className="src">Strike point difference {Math.abs(tally.strike.a - tally.strike.b)}: the round is decided on strikes (Outrance §15.3.1).</p>}
      {even && ask.length > 0 && (
        <div className="om-ask" role="group" aria-label={CRITERION_LABEL[ask[0]]}>
          <p><b>Difference {Math.abs(tally.strike.a - tally.strike.b)}: 5 or less.</b> {CRITERION_LABEL[ask[0]]}: who was better?</p>
          <div className="om-calls">
            <button type="button" className="om-call om-call-a" disabled={busy} onClick={() => answer('a')} data-testid="om-call-a">{who('a')}</button>
            <button type="button" className="om-call om-call-even" disabled={busy} onClick={() => answer('even')} data-testid="om-call-even">Even</button>
            <button type="button" className="om-call om-call-b" disabled={busy} onClick={() => answer('b')} data-testid="om-call-b">{who('b')}</button>
          </div>
        </div>
      )}
      {even && Object.keys(calls).length > 0 && (
        <ol className="om-given src" aria-label="Your criteria">
          {Object.entries(calls).map(([k, v]) => <li key={k}>{CRITERION_LABEL[k as keyof typeof CRITERION_LABEL]}: {v === 'even' ? 'Even' : sides[v as 'a' | 'b'].name}</li>)}
        </ol>
      )}
      {ready && (
        <p className="om-result" data-testid="om-result">
          Your round: <b className="mono">{sides.a.name} {preview.a} – {preview.b} {sides.b.name}</b> · {BAND_LABEL[preview.band]}{preview.decidedBy ? ` (${CRITERION_LABEL[preview.decidedBy].toLowerCase()})` : ''}{preview.winner === null ? ' · drawn round' : ''}
        </p>
      )}
      {ready && <p className="src">Cards, armour repairs and 3 or more weapon losses come off when the secretary confirms the round.</p>}
      {message && <p className="ly-note" role="alert">{message}</p>}
      <div className="dlg-actions">
        <button type="button" className="btn btn-line" disabled={busy} onClick={() => (Object.keys(calls).length ? setCalls({}) : onClose())}>{Object.keys(calls).length ? 'Start the criteria again' : 'Back to counting'}</button>
        <button type="button" className="btn btn-win" disabled={busy || !ready} onClick={() => onSubmit(even ? calls : {})} data-testid="om-submit">{busy ? 'Handing in…' : 'Hand in sheet'}</button>
      </div>
    </Dialog>
  );
}
