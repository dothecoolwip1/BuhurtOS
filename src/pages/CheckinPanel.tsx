import { useEffect, useMemo, useState } from 'react';
import { Chip, Seg } from '../components/ui';
import { setRegistrationCheck, type CheckName, type ManagedRegistration } from '../data/manage';
import { friendlyError } from '../lib/friendlyError';
import {
  applyOverride, attentionItems, blockedBecause, checkinCounts, filterCheckin, isCleared,
  type AttentionKind, type CheckinFilter, type CheckinOverride
} from '../registration/checkin';

const BIG: React.CSSProperties = { minHeight: 56, flex: '1 1 140px', fontSize: 17 };

/** Mobile-first check-in: search, filters, one-thumb buttons. Updates show at once and roll back with a plain error if saving fails. */
export function CheckinPanel({ regs, loading, onChanged }: { regs: ManagedRegistration[]; loading: boolean; onChanged: () => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CheckinFilter>('todo');
  const [overrides, setOverrides] = useState<Record<string, CheckinOverride>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Fresh data from the server replaces any optimistic guesses that are no longer in flight.
  useEffect(() => { setOverrides(o => Object.fromEntries(Object.entries(o).filter(([id]) => pending[id]))); }, [regs]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => regs.map(r => applyOverride(r, overrides[r.id])), [regs, overrides]);
  const counts = checkinCounts(shown);
  const list = filterCheckin(shown, filter, query);

  const toggle = async (r: ManagedRegistration, name: CheckName) => {
    const key = name === 'checked_in' ? 'checkedIn' : 'kitPassed';
    const next = !r[key];
    setError(null);
    setPending(p => ({ ...p, [r.id]: true }));
    setOverrides(o => ({ ...o, [r.id]: { ...o[r.id], [key]: next } }));
    try {
      await setRegistrationCheck(r.id, name, next);
      onChanged();
    } catch (e) {
      setOverrides(o => { const { [key]: _drop, ...rest } = o[r.id] ?? {}; const n = { ...o }; if (Object.keys(rest).length) n[r.id] = rest; else delete n[r.id]; return n; });
      setError(`Could not save for ${r.fullName}. ${friendlyError(e)}`);
    } finally {
      setPending(p => { const { [r.id]: _x, ...rest } = p; return rest; });
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="panel info" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 2 }} aria-live="polite">
        <span><b className="mono">{counts.checkedIn}/{counts.accepted}</b> checked in</span>
        <span><b className="mono">{counts.blocked}</b> blocked</span>
        <span><b className="mono">{counts.ready}</b> ready to check in</span>
        <span><b className="mono">{counts.kitPending}</b> kit to check</span>
      </div>
      <label className="field-in">Search name, team or category
        <input type="search" inputMode="search" autoComplete="off" value={query} onChange={e => setQuery(e.target.value)} style={{ minHeight: 52, fontSize: 18 }} />
      </label>
      <Seg label="Show" value={filter} onChange={setFilter} options={[
        ['todo', `Not in yet ${counts.todo}`], ['blocked', `Blocked ${counts.blocked}`], ['ready', `Ready ${counts.ready}`], ['all', 'All']
      ] as const} />
      {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
      {loading && regs.length === 0 && <p className="muted">Loading registrations…</p>}
      {!loading && list.length === 0 && <div className="panel info"><h3>{counts.accepted === 0 ? 'Nobody accepted yet' : 'Nobody matches'}</h3></div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {list.map(r => {
          const why = blockedBecause(r);
          const busy = pending[r.id] === true;
          return (
            <article key={r.id} className="panel info" style={{ display: 'grid', gap: 8 }} aria-label={r.fullName}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <h3>{r.fullName}</h3>
                {r.isVolunteer && <Chip>Volunteer</Chip>}
                {isCleared(r) ? <Chip tone="win">Cleared</Chip> : why ? <Chip tone="brass">Blocked</Chip> : null}
              </div>
              <p style={{ color: 'var(--muted)' }}>{r.teamName ?? 'No team'} · {r.categories.map(c => c.name).join(', ') || 'no categories'}</p>
              {why && <p style={{ color: 'var(--live)', fontWeight: 600 }}>{why}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className={`btn ${r.checkedIn ? 'btn-ink' : 'btn-line'}`} style={BIG} disabled={busy} aria-pressed={r.checkedIn} onClick={() => toggle(r, 'checked_in')}>
                  {r.checkedIn ? 'Checked in ✓ (undo)' : why ? 'Check in anyway' : 'Check in'}
                </button>
                {!r.isVolunteer && (
                  <button type="button" className={`btn ${r.kitPassed ? 'btn-ink' : 'btn-line'}`} style={BIG} disabled={busy} aria-pressed={r.kitPassed} onClick={() => toggle(r, 'kit')}>
                    {r.kitPassed ? 'Kit passed ✓ (undo)' : 'Kit check'}
                  </button>
                )}
              </div>
              <details>
                <summary>Emergency contact</summary>
                <p style={{ color: 'var(--muted)', overflowWrap: 'anywhere', marginTop: 6 }}>
                  <b>{r.emergencyName}</b>{r.emergencyRelationship ? ` (${r.emergencyRelationship})` : ''} · <a href={`tel:${r.emergencyPhone}`}>{r.emergencyPhone}</a>
                </p>
              </details>
            </article>
          );
        })}
      </div>
      <p className="src">The signed waiver is not recorded in registration data yet, so it is not part of the blocked reasons.</p>
    </div>
  );
}

/** The strip at the top of the organizer page. Each item jumps to where it is dealt with. */
export function AttentionStrip({ regs, teamsWithoutCaptain, onPick }: { regs: ManagedRegistration[]; teamsWithoutCaptain?: number; onPick: (k: AttentionKind) => void }) {
  const items = attentionItems(regs, teamsWithoutCaptain);
  if (items.length === 0) return null;
  return (
    <section className="panel info" aria-label="Needs attention now" style={{ display: 'grid', gap: 8 }}>
      <h3>Needs attention now</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {items.map(i => <button key={i.kind} type="button" className="btn btn-line" onClick={() => onPick(i.kind)}>{i.label}</button>)}
      </div>
    </section>
  );
}
