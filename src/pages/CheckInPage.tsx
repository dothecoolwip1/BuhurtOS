import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { canRecordClearance, listClearanceRequirements, listLatestClearances, recordClearance, setClearanceRequirement, type ClearanceOutcome, type ClearanceRequirement, type ClearanceStatus } from '../lib/clearanceAdmin';
import { hasPermission } from '../lib/permissions';

const statuses:ClearanceStatus[]=['passed','failed','reinspection_required','waived'];

export function CheckInPage(){
  const {event,roster,user,reload}=useAppState();
  const [requirements,setRequirements]=useState<ClearanceRequirement[]>([]);
  const [outcomes,setOutcomes]=useState<ClearanceOutcome[]>([]);
  const [query,setQuery]=useState('');
  const [showBlocked,setShowBlocked]=useState(false);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState('');
  const [notes,setNotes]=useState<Record<string,string>>({});
  const canConfigure=Boolean(event&&hasPermission(user,'event.manage',event.id,event.organizationId));

  const refresh=async()=>{
    if(!event)return;
    const [reqs,rows]=await Promise.all([listClearanceRequirements(event.id),listLatestClearances(event.id)]);
    setRequirements(reqs);setOutcomes(rows);
  };
  useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load clearance station.'));},[event?.id]);
  if(!event)return <div className="state-card">No event selected.</div>;

  const latest=new Map(outcomes.map(o=>[`${o.rosterEntryId}:${o.clearanceType}`,o]));
  const required=requirements.filter(r=>r.required);
  const rows=useMemo(()=>roster.filter(entry=>{
    const text=`${entry.displayName} ${entry.teamId??''}`.toLowerCase();
    if(query&&!text.includes(query.toLowerCase()))return false;
    if(!showBlocked)return true;
    return required.some(req=>latest.get(`${entry.id}:${req.clearanceType}`)?.status!=='passed'&&latest.get(`${entry.id}:${req.clearanceType}`)?.status!=='waived');
  }),[roster,query,showBlocked,required.map(r=>`${r.id}:${r.required}`).join('|'),outcomes]);

  const setOutcome=async(entryId:string,req:ClearanceRequirement,status:ClearanceStatus)=>{
    if(!canRecordClearance(user,event.id,event.organizationId,req.clearanceType))return;
    const key=`${entryId}:${req.clearanceType}`;
    setBusy(key);setMessage('');
    try{await recordClearance(event.id,entryId,req.clearanceType,status,notes[key]);setNotes(n=>({...n,[key]:''}));await Promise.all([refresh(),reload()]);}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to record clearance.');}finally{setBusy('');}
  };
  const toggleRequirement=async(req:ClearanceRequirement)=>{
    setBusy(req.id);setMessage('');
    try{await setClearanceRequirement(event.id,req,!req.required);await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to change clearance requirements.');}finally{setBusy('');}
  };

  const clearedCount=roster.filter(entry=>required.every(req=>['passed','waived'].includes(latest.get(`${entry.id}:${req.clearanceType}`)?.status??'pending'))).length;

  return <>
    <section className="section-head">
      <div><span className="eyebrow">Event day</span><h1>Check In & Clearance</h1><p>Each inspection is timestamped and attributed. Failed items keep their history when a competitor returns for reinspection.</p></div>
      <div className="header-actions"><span className="status-pill ok">{clearedCount} fully cleared</span><span className="status-pill">{roster.length-clearedCount} pending</span></div>
    </section>

    <section className="panel-card clearance-toolbar">
      <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search competitor or team" aria-label="Search competitors"/>
      <label className="checkbox-line"><input type="checkbox" checked={showBlocked} onChange={e=>setShowBlocked(e.target.checked)}/><span>Show only incomplete</span></label>
    </section>

    {canConfigure&&<section className="panel-card requirement-strip"><div><strong>Required checks</strong><small>Optional checks remain available but do not block eligibility.</small></div><div>{requirements.map(req=><button key={req.id} disabled={busy===req.id} className={req.required?'selected':''} onClick={()=>toggleRequirement(req)}>{req.label}<small>{req.required?'Required':'Optional'}</small></button>)}</div></section>}

    <div className="clearance-list">{rows.map(entry=>{
      const incomplete=required.filter(req=>!['passed','waived'].includes(latest.get(`${entry.id}:${req.clearanceType}`)?.status??'pending'));
      return <article className="clearance-card" key={entry.id}>
        <div className="clearance-person"><div><strong>{entry.displayName}</strong><small>{entry.entryType.replaceAll('_',' ')}{entry.teamId?` · ${entry.teamId}`:''}</small></div><span className={`eligibility ${incomplete.length===0?'ok':'blocked'}`}>{incomplete.length===0?'CLEARED':`${incomplete.length} LEFT`}</span></div>
        <div className="clearance-grid">{requirements.map(req=>{
          const key=`${entry.id}:${req.clearanceType}`,outcome=latest.get(key),authorized=canRecordClearance(user,event.id,event.organizationId,req.clearanceType);
          return <section className={`clearance-cell ${outcome?.status??'pending'}`} key={req.id}>
            <div><strong>{req.label}</strong>{req.required?<span>Required</span>:<span>Optional</span>}</div>
            <small>{outcome?outcome.status.replaceAll('_',' '):'Not checked'}{outcome?.inspectedAt?` · ${new Date(outcome.inspectedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:''}</small>
            {outcome?.notes&&<p>{outcome.notes}</p>}
            {authorized&&<><input value={notes[key]??''} onChange={e=>setNotes(n=>({...n,[key]:e.target.value}))} placeholder="Note if needed" aria-label={`${req.label} note for ${entry.displayName}`}/><div className="clearance-actions">{statuses.map(status=><button key={status} disabled={busy===key||(status==='failed'&&!notes[key]?.trim())} className={outcome?.status===status?'selected':''} onClick={()=>setOutcome(entry.id,req,status)}>{status==='reinspection_required'?'Reinspect':status}</button>)}</div></>}
          </section>;
        })}</div>
      </article>;
    })}</div>
    {rows.length===0&&<div className="state-card">No competitors match the current filter.</div>}
    {message&&<div className="auth-message">{message}</div>}
  </>;
}
