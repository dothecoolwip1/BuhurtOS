import { useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { checkCompliance } from '../lib/compliance';
import { hasPermission, type Permission } from '../lib/permissions';

const fields = [
  ['checkedIn','Check in','roster.manage'],
  ['armorCleared','Armor','armor.inspect'],
  ['medicalCleared','Medical','medical.manage'],
  ['waiverConfirmed','Waiver','roster.manage'],
  ['weighInCleared','Weigh in','roster.manage']
] as const satisfies ReadonlyArray<readonly [string,string,Permission]>;

export function RosterPage() {
  const { roster,updateCompliance,user,event }=useAppState();
  const [busyKey,setBusyKey]=useState('');
  const [message,setMessage]=useState('');

  const capabilities=useMemo(()=>{
    if(!event)return new Set<Permission>();
    const permissions:Permission[]=['roster.manage','armor.inspect','medical.manage'];
    return new Set(permissions.filter(permission=>hasPermission(user,permission,event.id,event.organizationId)));
  },[event,user]);

  const canEdit=(permission:Permission)=>capabilities.has('roster.manage')||capabilities.has(permission);

  const change=async(entryId:string,field:'checkedIn'|'armorCleared'|'medicalCleared'|'waiverConfirmed'|'weighInCleared',value:boolean)=>{
    const key=entryId+':'+field;
    setBusyKey(key);setMessage('');
    try{await updateCompliance(entryId,field,value);}
    catch(error){setMessage(error instanceof Error?error.message:'Unable to update clearance.');}
    finally{setBusyKey('');}
  };

  return <>
    <section className="section-head"><div><span className="eyebrow">Event roster</span><h1>Compliance Gate</h1><p>Each specialist only receives controls for the clearances their role is allowed to record.</p></div></section>
    {message&&<div className="auth-message">{message}</div>}
    {roster.length===0?<div className="state-card"><h2>No competitors yet</h2><p>Approved registrations and temporary fighters will appear here.</p></div>:<div className="roster-list">{roster.map(entry=>{
      const compliance=checkCompliance(entry);
      return <article className="roster-card" key={entry.id}>
        <div className="roster-main"><div><strong>{entry.displayName}</strong><small>{entry.entryType.replaceAll('_',' ')}{entry.teamId?' • '+entry.teamId:''}</small></div><span className={'eligibility '+(compliance.eligible?'ok':'blocked')}>{compliance.eligible?'CLEARED':'BLOCKED'}</span></div>
        <div className="check-grid">{fields.map(([field,label,permission])=>{
          const editable=canEdit(permission);
          const key=entry.id+':'+field;
          return <label key={field} className={(entry[field]?'checked ':'')+(!editable?'read-only':'')} title={editable?undefined:'Your event role cannot change this clearance.'}>
            <input type="checkbox" checked={entry[field]} disabled={!editable||busyKey===key} onChange={e=>change(entry.id,field,e.target.checked)}/>
            <span>{label}</span>
          </label>;
        })}</div>
        {!compliance.eligible&&<div className="missing-line">Missing: {compliance.missing.join(', ')}</div>}
      </article>;
    })}</div>}
  </>;
}
