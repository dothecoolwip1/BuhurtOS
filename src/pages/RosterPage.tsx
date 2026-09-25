import { useState } from 'react';
import { useAppState } from '../features/AppState';
import { checkCompliance, checkPhysicalCompliance } from '../lib/compliance';
import { hasPermission } from '../lib/permissions';

const fields = [
  ['checkedIn', 'Check in'], ['armorCleared', 'Armor'], ['medicalCleared', 'Medical'], ['waiverConfirmed', 'Waiver'], ['weighInCleared', 'Weigh in']
] as const;

export function RosterPage() {
  const { roster, updateCompliance, setCompetitionClearance, user, event } = useAppState();
  const [message,setMessage]=useState('');
  const canManage = Boolean(event && hasPermission(user, 'roster.manage', event.id, event.organizationId));
  const toggleFinal = async (entryId:string,value:boolean) => {
    setMessage('');
    try { await setCompetitionClearance(entryId,value); }
    catch(error){ setMessage(error instanceof Error?error.message:'Unable to change competition clearance.'); }
  };
  return <>
    <section className="section-head"><div><span className="eyebrow">Event roster</span><h1>Compliance Gate</h1><p>Registration approval, physical check in and final competition clearance are separate gates. Only a marshal clearance makes an entry competition ready.</p></div></section>
    {message&&<div className="auth-message">{message}</div>}
    <div className="roster-list">{roster.map(entry => {
      const physical = checkPhysicalCompliance(entry);
      const compliance = checkCompliance(entry);
      return <article className="roster-card" key={entry.id}>
        <div className="roster-main"><div><strong>{entry.displayName}</strong><small>{entry.entryType.replaceAll('_', ' ')} · registration {entry.attendanceStatus.replaceAll('_',' ')}</small></div>
          <span className={`eligibility ${compliance.eligible ? 'ok' : 'blocked'}`}>{compliance.eligible ? 'CLEARED' : physical.eligible ? 'READY FOR MARSHAL' : 'BLOCKED'}</span>
        </div>
        <div className="check-grid">{fields.map(([field, label]) => <label key={field} className={entry[field] ? 'checked' : ''}><input type="checkbox" checked={entry[field]} disabled={!canManage || entry.attendanceStatus!=='approved'} onChange={e => updateCompliance(entry.id, field, e.target.checked)}/><span>{label}</span></label>)}</div>
        {!physical.eligible && <div className="missing-line">Physical gate missing: {physical.missing.join(', ')}</div>}
        <div className="header-actions">
          <button className={entry.competitionCleared?'primary':''} disabled={!canManage || (!physical.eligible && !entry.competitionCleared)} onClick={()=>toggleFinal(entry.id,!entry.competitionCleared)}>
            {entry.competitionCleared ? 'Revoke Competition Clearance' : 'Grant Competition Clearance'}
          </button>
        </div>
        {!compliance.eligible && physical.eligible && !entry.competitionCleared && <div className="missing-line">A marshal must grant final competition clearance.</div>}
      </article>;
    })}</div>
  </>;
}
