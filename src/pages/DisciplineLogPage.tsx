import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { PageHead, Seg } from '../components/ui';
import { fetchEvent } from '../data/api';
import { fetchDisciplineLog, type DisciplineLogRow } from '../data/rules';
import { describeRow, groupDiscipline, type LogFilter } from '../lib/rules/disciplineLog';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const FILTERS: readonly (readonly [LogFilter, string])[] = [['all', 'All'], ['card', 'Cards'], ['warning', 'Warnings'], ['deduction', 'Points off'], ['dq', 'DQ']];
const REFRESH_MS = 30_000;
const TOTAL_WORD = { card: 'Cards', warning: 'Warnings', deduction: 'Deductions', dq: 'Disqualifications' } as const;

/**
 * Pack 22: every official warning, card, point deduction and disqualification at the event, by fighter, with the reason, the marshal, the fight and
 * the rule cited. For this event's officials (the database refuses everyone else). Read-only: records are made and voided on the field tablet.
 * It shows counts; it never decides what they mean (that is the governing body's rule, applied by the head marshal).
 */
export function DisciplineLogPage() {
  const { eventId: slug = '' } = useParams();
  const { session, loading: authLoading } = useAuth();
  const ev = useAsync(() => fetchEvent(slug), [slug]);
  useDocumentTitle(ev.data ? `Discipline · ${ev.data.event.name}` : 'Discipline');
  if (authLoading || (ev.loading && !ev.data)) return <p className="muted" role="status">Loading…</p>;
  if (ev.error != null) return <p role="alert">{friendlyError(ev.error, 'Could not load this event.')}</p>;
  if (!ev.data) return <><PageHead eyebrow="Discipline" title="Event not found" /><p>This event does not exist, or is not visible to you.</p></>;
  if (!session) return <><PageHead eyebrow="Discipline" title={ev.data.event.name} /><SignIn reason="Sign in with an account that officiates at this event." /></>;
  return <Log eventId={ev.data.event.id} slug={slug} name={ev.data.event.name} />;
}

function Log({ eventId, slug, name }: { eventId: string; slug: string; name: string }) {
  const [tick, setTick] = useState(0);
  const log = useAsync(() => fetchDisciplineLog(eventId), [eventId], [tick]);
  useEffect(() => {
    const t = window.setInterval(() => setTick(n => n + 1), REFRESH_MS);
    const again = () => { if (document.visibilityState === 'visible') setTick(n => n + 1); };
    window.addEventListener('online', again); document.addEventListener('visibilitychange', again);
    return () => { window.clearInterval(t); window.removeEventListener('online', again); document.removeEventListener('visibilitychange', again); };
  }, []);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [voided, setVoided] = useState(false);
  const [q, setQ] = useState('');
  const rows = log.data ?? [];
  const groups = useMemo(() => groupDiscipline(rows, filter, voided, q), [rows, filter, voided, q]);
  const active = rows.filter(r => !r.voided_at);
  const refused = (log.error as { code?: string } | null)?.code === '42501';

  if (refused) return <><PageHead eyebrow="Discipline" title={name} /><p role="alert">Only this event's officials can read its discipline log.</p></>;
  return (
    <section className="fade-in dl-page">
      <div><p className="eyebrow">Discipline · {name}</p><h1 style={{ fontSize: 'clamp(32px,6vw,56px)', marginTop: 6 }}>Cards and penalties</h1></div>
      <p className="src">Recorded on the field tablets from the marshal's call. Voided records stay, with their reason, and are never counted. What a number of cards means is decided by the rules and the head marshal, not by BuhurtOS.</p>
      {log.loading && !log.data && <p className="src" role="status">Loading…</p>}
      {log.error != null && !log.data && <p role="alert">{friendlyError(log.error, 'Could not load the discipline log.')}</p>}
      {log.refreshError != null && <p className="src" role="status">Could not refresh just now; showing the last loaded list.</p>}
      {log.data && (
        <>
          <div className="dl-sum" aria-label="Totals in force">
            {(['card', 'warning', 'deduction', 'dq'] as const).map(k => <div key={k}><b>{active.filter(r => r.kind === k).length}</b><span>{TOTAL_WORD[k]}</span></div>)}
          </div>
          <Seg label="Show" value={filter} options={FILTERS} onChange={setFilter} scroll />
          <div className="rl-filters">
            <label className="rulesearch" style={{ flex: '1 1 220px' }}><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a fighter or team" aria-label="Find a fighter or team" /></label>
            <label className="rl-check"><input type="checkbox" checked={voided} onChange={e => setVoided(e.target.checked)} /> Show voided</label>
          </div>
          {groups.length === 0 ? <p className="rl-none" role="status">{rows.length ? 'Nothing matches.' : 'No cards, warnings or penalties recorded at this event.'}</p> : (
            <div className="rl-groups">
              {groups.map(p => (
                <details key={p.key} className="dl-person" open={groups.length <= 6}>
                  <summary>
                    <span>{p.name}</span>
                    <span className="dl-tally">
                      {Object.entries(p.cards).map(([label, n]) => <span key={label} className="chip brass">{n} × {label}</span>)}
                      {p.tally.warning > 0 && <span className="chip">{p.tally.warning} warning{p.tally.warning === 1 ? '' : 's'}</span>}
                      {p.tally.deduction > 0 && <span className="chip">{p.tally.deduction} deduction{p.tally.deduction === 1 ? '' : 's'}</span>}
                      {p.tally.dq > 0 && <span className="chip live">DQ</span>}
                    </span>
                  </summary>
                  <ul className="dl-items">{p.rows.map(r => <Item key={r.id} r={r} />)}</ul>
                </details>
              ))}
            </div>
          )}
        </>
      )}
      <p className="src"><Link className="lnk" to={`/events/${slug}/command`}>Command Centre</Link> · <Link className="lnk" to="/rules">Rules</Link></p>
    </section>
  );
}

function Item({ r }: { r: DisciplineLogRow }) {
  const at = new Date(r.created_at);
  return (
    <li className={r.voided_at ? 'void' : ''}>
      <span className="dl-what">{describeRow(r)} · round {r.round_no}{r.voided_at ? ' · voided' : ''}</span>
      <span className="dl-where">{r.competition_name}{r.round_label ? ` · ${r.round_label}` : ''}{r.field ? ` · ${r.field}` : ''} · {at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      {(r.reason || r.called_by) && <span className="dl-where">{[r.reason, r.called_by ? `called by ${r.called_by}` : null].filter(Boolean).join(' · ')}</span>}
      {r.provision_id && <span className="rl-cite">Rule cited: <Link className="lnk" to={`/rules/r/${r.provision_id}`}>{r.rule_number ? `${r.rule_number} ` : ''}{r.rule_title ?? ''}</Link> ({r.rule_document} {r.rule_version}{r.rule_version_status && r.rule_version_status !== 'published' ? `, ${r.rule_version_status}` : ''}){r.citation_changes > 1 ? ' · changed since first recorded' : ''}</span>}
      {r.voided_at && r.void_reason && <span className="dl-where">Voided: {r.void_reason}</span>}
      {r.recorded_by_name && <span className="dl-where">Recorded by {r.recorded_by_me ? 'you' : r.recorded_by_name}</span>}
    </li>
  );
}
