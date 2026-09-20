import { useAppState } from '../features/AppState';
import { checkCompliance } from '../lib/compliance';
import { hasPermission } from '../lib/permissions';

const fields = [
  ['checkedIn', 'Check in'], ['armorCleared', 'Armor'], ['medicalCleared', 'Medical'], ['waiverConfirmed', 'Waiver'], ['weighInCleared', 'Weigh in']
] as const;

export function RosterPage() {
  const { roster, updateCompliance, user, event } = useAppState();
  const canManage = Boolean(event && hasPermission(user, 'roster.manage', event.id, event.organizationId));
  return <>
    <section className="section-head"><div><span className="eyebrow">Event roster</span><h1>Compliance Gate</h1><p>Competitors cannot be placed into live competition until required clearances are complete.</p></div></section>
    <div className="roster-list">{roster.map(entry => {
      const compliance = checkCompliance(entry);
      return <article className="roster-card" key={entry.id}>
        <div className="roster-main"><div><strong>{entry.displayName}</strong><small>{entry.entryType.replaceAll('_', ' ')}{entry.teamId ? ` • ${entry.teamId}` : ''}</small></div><span className={`eligibility ${compliance.eligible ? 'ok' : 'blocked'}`}>{compliance.eligible ? 'CLEARED' : 'BLOCKED'}</span></div>
        <div className="check-grid">{fields.map(([field, label]) => <label key={field} className={entry[field] ? 'checked' : ''}><input type="checkbox" checked={entry[field]} disabled={!canManage} onChange={e => updateCompliance(entry.id, field, e.target.checked)}/><span>{label}</span></label>)}</div>
        {!compliance.eligible && <div className="missing-line">Missing: {compliance.missing.join(', ')}</div>}
      </article>;
    })}</div>
  </>;
}
