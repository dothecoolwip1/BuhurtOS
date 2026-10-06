import { fetchFighterDiscipline, REVIEW_WORD, OUTCOME_WORD, SANCTION_WORD } from '../../data/discipline';
import { useAsync } from '../../lib/useAsync';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/**
 * Pack 22: a fighter's own disciplinary record: suspensions (in force first), sanctions given at events, authenticity infractions and appeals.
 * Visible only to the fighter's own accounts and the people who manage them (the database refuses everyone else; then nothing is shown).
 * No staff notes and no reasons of the issuing authority: what, where, when and until when.
 */
export function FighterDisciplineRecord({ fighterId, isMine }: { fighterId: string; isMine: boolean }) {
  const r = useAsync(() => fetchFighterDiscipline(fighterId), [fighterId]);
  if (!r.data) return null;
  const d = r.data;
  const empty = !d.suspensions.length && !d.sanctions.length && !d.findings.length && !d.reviews.length;
  if (empty && !isMine) return null;
  const inForce = d.suspensions.filter(s => s.in_force);
  return (
    <section className="panel info dd-record" aria-labelledby="fdr-h" data-testid="discipline-record">
      <h2 id="fdr-h" className="h3">{isMine ? 'Your discipline record' : 'Discipline record'}</h2>
      <p className="src" style={{ margin: 0 }}>Only you{isMine ? '' : ' (as someone who manages this fighter)'} and the officials concerned can see this.</p>
      {empty && <p className="muted" style={{ margin: 0 }}>Nothing is recorded.</p>}
      {inForce.map(s => <p key={s.id} className="desk-block" role="status" style={{ margin: 0 }}><b>{s.label}.</b> {s.event ? `Decided at ${s.event}. ` : s.organization ? `Decided by ${s.organization}. ` : 'Decided at platform level. '}You cannot be accepted, checked in or entered where it applies until it ends or is lifted.</p>)}
      {d.suspensions.filter(s => !s.in_force).length > 0 && <ul className="dd-list">{d.suspensions.filter(s => !s.in_force).map(s => <li key={s.id} className="void"><span className="dd-what">{s.label}{s.lifted_at ? ' · lifted' : s.superseded ? ' · replaced' : ' · ended'}</span><span className="dl-where">From {day(s.starts_at)}{s.event ? ` · ${s.event}` : s.organization ? ` · ${s.organization}` : ''}</span></li>)}</ul>}
      {d.sanctions.length > 0 && <ul className="dd-list">{d.sanctions.map(s => <li key={s.id} className={s.status === 'active' ? '' : 'void'}><span className="dd-what">{s.kind === 'card' ? s.label : SANCTION_WORD[s.kind]}{s.status !== 'active' ? ` · ${s.status}` : ''}</span><span className="dl-where">{s.event} · {day(s.created_at)}</span></li>)}</ul>}
      {d.findings.length > 0 && <ul className="dd-list">{d.findings.map(f => <li key={f.id} className={f.status === 'open' ? '' : 'void'}><span className="dd-what">Authenticity: {f.severity} · {f.item}{f.status !== 'open' ? ` · ${f.status}` : ''}</span><span className="dl-where">{f.event} · {day(f.created_at)}</span></li>)}</ul>}
      {d.reviews.length > 0 && <ul className="dd-list">{d.reviews.map(x => <li key={x.id}><span className="dd-what">{REVIEW_WORD[x.kind]} · {x.status === 'decided' && x.outcome ? OUTCOME_WORD[x.outcome] ?? x.outcome : x.status}</span><span className="dl-where">Lodged {day(x.lodged_at)}{x.status === 'lodged' ? ` · decision due by ${day(x.due_by)}` : ''}</span></li>)}</ul>}
    </section>
  );
}
