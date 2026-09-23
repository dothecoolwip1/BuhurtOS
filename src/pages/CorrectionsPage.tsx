import { useEffect, useState } from 'react';
import { useAppState } from '../features/AppState';
import { listCorrections, reviewCorrection } from '../lib/competitionAdmin';
import { hasPermission } from '../lib/permissions';
import type { CorrectionRequest } from '../types';

const reviewStates:CorrectionRequest['status'][]=['under_review','needs_information','approved','rejected','applied'];

export function CorrectionsPage(){
  const {event,user}=useAppState();
  const [rows,setRows]=useState<CorrectionRequest[]>([]);
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState('');
  const canReview=Boolean(event&&hasPermission(user,'correction.review',event.id,event.organizationId));
  const refresh=async()=>{if(event)setRows(await listCorrections(event.id));};
  useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load corrections.'));},[event?.id]);
  if(!event)return <div className="state-card">No event selected.</div>;

  const update=async(row:CorrectionRequest,status:CorrectionRequest['status'])=>{
    if(!canReview)return;
    if(['approved','rejected','applied'].includes(status)&&!notes[row.id]?.trim())return setMessage('Resolution notes are required before closing or approving a correction.');
    setBusy(row.id);setMessage('');
    try{await reviewCorrection(row.id,status,notes[row.id]);await refresh();setMessage('Correction status updated and audited.');}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to review correction.');}finally{setBusy('');}
  };

  return <>
    <section className="section-head"><div><span className="eyebrow">Data integrity</span><h1>Correction Queue</h1><p>Review reported errors without erasing the original administrative trail.</p></div><div className="header-actions"><span className="status-pill">{rows.filter(r=>!['rejected','applied'].includes(r.status)).length} open</span></div></section>
    {rows.length===0?<div className="state-card">No correction requests have been filed for this event.</div>:<div className="correction-list">{rows.map(row=><article className="panel-card" key={row.id}>
      <div className="panel-title-row"><div><span className="eyebrow">{row.category.replaceAll('_',' ')}</span><h2>{row.entityType??'Event data'}{row.entityId?<small> · {row.entityId}</small>:null}</h2></div><span className={`validation-state ${row.status}`}>{row.status.replaceAll('_',' ')}</span></div>
      <p>{row.description}</p>
      {row.evidenceLinks.length>0&&<div className="evidence-links">{row.evidenceLinks.map(link=><a href={link} target="_blank" rel="noreferrer" key={link}>Evidence ↗</a>)}</div>}
      <small>Submitted {new Date(row.createdAt).toLocaleString()}</small>
      {canReview&&<><label className="form-stack">Review notes<textarea value={notes[row.id]??row.resolutionNotes??''} onChange={e=>setNotes(current=>({...current,[row.id]:e.target.value}))} placeholder="Required for approval, rejection, or applied correction"/></label><div className="validation-actions">{reviewStates.map(status=><button key={status} disabled={busy===row.id||row.status===status} onClick={()=>update(row,status)}>{status.replaceAll('_',' ')}</button>)}</div></>}
    </article>)}</div>}
    {message&&<div className="auth-message">{message}</div>}
  </>;
}
