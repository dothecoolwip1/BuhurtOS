import { useEffect, useState } from 'react';
import { useAppState } from '../features/AppState';
import { createRing, listRings, setRingStatus } from '../lib/competitionAdmin';
import { hasPermission } from '../lib/permissions';
import type { RingRecord, RingStatus } from '../types';

const statuses:RingStatus[]=['idle','preparing','ready','match_underway','medical_hold','marshal_review','delayed','closed'];

export function RingControlPage(){
  const {event,user}=useAppState();
  const [rings,setRings]=useState<RingRecord[]>([]);
  const [newName,setNewName]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState('');
  const canManage=Boolean(event&&hasPermission(user,'ring.manage',event.id,event.organizationId));

  const refresh=async()=>{if(event)setRings(await listRings(event.id));};
  useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load rings.'));},[event?.id]);
  if(!event)return <div className="state-card">No event selected.</div>;

  const add=async()=>{
    setMessage('');setBusy('new');
    try{await createRing(event.id,newName);setNewName('');await refresh();setMessage('Competition area added.');}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to add ring.');}finally{setBusy('');}
  };
  const change=async(ring:RingRecord,status:RingStatus)=>{
    if(!canManage)return;
    setBusy(ring.id);setMessage('');
    try{await setRingStatus(event.id,ring.id,status,ring.statusNote);await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to change ring state.');}finally{setBusy('');}
  };
  const note=async(ring:RingRecord,value:string)=>{
    if(!canManage)return;
    setBusy(ring.id);setMessage('');
    try{await setRingStatus(event.id,ring.id,ring.status,value);await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to save ring note.');}finally{setBusy('');}
  };

  return <>
    <section className="section-head"><div><span className="eyebrow">Venue operations</span><h1>Ring Control</h1><p>Every competition area has one explicit operational state. Public displays can consume the same state through Realtime.</p></div></section>
    {canManage&&<section className="panel-card inline-panel"><div><h2>Add competition area</h2><p>Use rings, fields, lists, or any venue-specific name.</p></div><div className="inline-form"><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Ring 4"/><button className="primary" disabled={busy==='new'||!newName.trim()} onClick={add}>Add</button></div></section>}
    {rings.length===0?<div className="state-card">No rings or fields have been configured for this event.</div>:<div className="ring-grid">{rings.map(ring=><article className={`ring-card ring-${ring.status}`} key={ring.id}>
      <div className="ring-card-head"><div><span className="eyebrow">Competition area</span><h2>{ring.name}</h2></div><span className={`ring-state ${ring.status}`}>{ring.status.replaceAll('_',' ')}</span></div>
      <div className="ring-state-grid">{statuses.map(status=><button key={status} disabled={!canManage||busy===ring.id} className={ring.status===status?'selected':''} onClick={()=>change(ring,status)}>{status.replaceAll('_',' ')}</button>)}</div>
      <label className="form-stack">Operational note<input defaultValue={ring.statusNote??''} disabled={!canManage||busy===ring.id} placeholder="Optional public-safe status note" onBlur={e=>{if(e.target.value!==(ring.statusNote??''))note(ring,e.target.value);}}/></label>
      <small>Updated {new Date(ring.updatedAt).toLocaleTimeString()}</small>
    </article>)}</div>}
    {message&&<div className="auth-message">{message}</div>}
  </>;
}
