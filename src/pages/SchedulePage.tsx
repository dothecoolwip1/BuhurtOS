import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { deleteScheduleItem, listRings, listSchedule, saveScheduleItem } from '../lib/competitionAdmin';
import { detectScheduleConflicts, type ScheduleAssignment } from '../lib/schedule';
import { hasPermission } from '../lib/permissions';
import type { RingRecord, ScheduleItem } from '../types';

const localInput=(date:Date)=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);

export function SchedulePage(){
  const {event,matches,user}=useAppState();
  const [items,setItems]=useState<ScheduleItem[]>([]);
  const [rings,setRings]=useState<RingRecord[]>([]);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const initialStart=event?new Date(event.startsAt):new Date();
  const [form,setForm]=useState({matchId:'',ringId:'',itemType:'match' as ScheduleItem['itemType'],title:'',startsAt:localInput(initialStart),endsAt:localInput(new Date(initialStart.getTime()+10*60000)),isPublic:true,notes:''});
  const canManage=Boolean(event&&hasPermission(user,'schedule.manage',event.id,event.organizationId));

  const refresh=async()=>{
    if(!event)return;
    const [schedule,ringRows]=await Promise.all([listSchedule(event.id),listRings(event.id)]);
    setItems(schedule);setRings(ringRows);
  };
  useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load schedule.'));},[event?.id]);
  if(!event)return <div className="state-card">No event selected.</div>;

  const participantIds=(matchId?:string)=>matches.find(m=>m.id===matchId)?.participants.filter(p=>p.rosterEntryId&&!p.isPlaceholder).map(p=>p.rosterEntryId!)??[];
  const assignments:ScheduleAssignment[]=items.map(item=>({id:item.id,startsAt:item.startsAt,endsAt:item.endsAt,ringId:item.ringId,participantIds:participantIds(item.matchId)}));
  const candidateState=useMemo(()=>{
    const start=new Date(form.startsAt);
    const end=new Date(form.endsAt);
    if(!form.startsAt||!form.endsAt||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start){
      return {valid:false,conflicts:[] as ReturnType<typeof detectScheduleConflicts>};
    }
    const candidate:ScheduleAssignment={id:'candidate',startsAt:start.toISOString(),endsAt:end.toISOString(),ringId:form.ringId||undefined,participantIds:participantIds(form.matchId)};
    try{
      return {valid:true,conflicts:detectScheduleConflicts([...assignments,candidate]).filter(c=>c.firstId==='candidate'||c.secondId==='candidate')};
    }catch{
      return {valid:false,conflicts:[] as ReturnType<typeof detectScheduleConflicts>};
    }
  },[items,form.startsAt,form.endsAt,form.ringId,form.matchId,matches]);
  const candidateConflicts=candidateState.conflicts;

  const save=async()=>{
    if(!form.title.trim()||!candidateState.valid)return setMessage('Enter a valid start and end time.');
    if(candidateConflicts.length)return setMessage('Resolve the schedule conflicts before saving.');
    setBusy(true);setMessage('');
    try{
      await saveScheduleItem(event.id,{matchId:form.matchId||undefined,ringId:form.ringId||undefined,itemType:form.itemType,title:form.title.trim(),startsAt:new Date(form.startsAt).toISOString(),endsAt:new Date(form.endsAt).toISOString(),status:'scheduled',isPublic:form.isPublic,notes:form.notes.trim()||undefined});
      await refresh();setMessage('Schedule item saved.');
      const next=new Date(form.endsAt);setForm(f=>({...f,matchId:'',title:'',startsAt:localInput(next),endsAt:localInput(new Date(next.getTime()+10*60000)),notes:''}));
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to save schedule item.');}finally{setBusy(false);}
  };
  const remove=async(item:ScheduleItem)=>{
    if(!window.confirm(`Remove "${item.title}" from the event schedule? Historical match records are not deleted.`))return;
    setBusy(true);setMessage('');
    try{await deleteScheduleItem(event.id,item.id);await refresh();setMessage('Schedule item removed.');}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to remove schedule item.');}finally{setBusy(false);}
  };
  const chooseMatch=(id:string)=>{
    const match=matches.find(m=>m.id===id);
    setForm(f=>({...f,matchId:id,itemType:'match',title:match?.label??f.title}));
  };

  return <>
    <section className="section-head"><div><span className="eyebrow">Event timeline</span><h1>Schedule</h1><p>Schedule matches, breaks, checks, meetings, and awards across multiple competition areas with overlap detection.</p></div><div className="header-actions"><span className="status-pill">{event.timezone}</span></div></section>
    <div className="admin-grid">
      {canManage&&<section className="panel-card"><h2>Add schedule item</h2><div className="form-stack">
        <label>Type<select value={form.itemType} onChange={e=>setForm(f=>({...f,itemType:e.target.value as ScheduleItem['itemType'],matchId:e.target.value==='match'?f.matchId:''}))}>{['match','break','ceremony','lunch','armor_check','meeting','awards','custom'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label>
        {form.itemType==='match'&&<label>Match<select value={form.matchId} onChange={e=>chooseMatch(e.target.value)}><option value="">Choose match</option>{matches.filter(m=>!['finalized','cancelled'].includes(m.status)).map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>}
        <label>Title<input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="What appears on the schedule"/></label>
        <label>Ring / area<select value={form.ringId} onChange={e=>setForm(f=>({...f,ringId:e.target.value}))}><option value="">No specific area</option>{rings.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <div className="form-grid"><label>Starts<input type="datetime-local" value={form.startsAt} onChange={e=>setForm(f=>({...f,startsAt:e.target.value}))}/></label><label>Ends<input type="datetime-local" value={form.endsAt} onChange={e=>setForm(f=>({...f,endsAt:e.target.value}))}/></label></div>
        <label>Notes<textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></label>
        <label className="checkbox-line"><input type="checkbox" checked={form.isPublic} onChange={e=>setForm(f=>({...f,isPublic:e.target.checked}))}/><span>Visible on public schedule</span></label>
        {candidateConflicts.length>0&&<div className="validation-errors">{candidateConflicts.map((conflict,index)=><div key={index}>{conflict.reason==='participant_overlap'?`Competitor overlap with ${conflict.firstId==='candidate'?conflict.secondId:conflict.firstId}`:`Ring overlap with ${conflict.firstId==='candidate'?conflict.secondId:conflict.firstId}`}</div>)}</div>}
        <button className="primary big" disabled={busy||!form.title.trim()||!candidateState.valid||candidateConflicts.length>0} onClick={save}>Save Schedule Item</button>
      </div></section>}

      <section className="panel-card"><h2>Conflict monitor</h2><p>BuhurtOS checks every saved interval for participant and ring collisions.</p>{(()=>{
        const conflicts=detectScheduleConflicts(assignments);
        return conflicts.length===0?<div className="state-card"><strong>No active conflicts</strong><p>The current schedule has no overlapping rings or competitors.</p></div>:<div className="validation-errors">{conflicts.map((c,i)=><div key={i}>{c.reason.replaceAll('_',' ')}: {c.firstId} ↔ {c.secondId}{c.participantIds.length?` · ${c.participantIds.join(', ')}`:''}</div>)}</div>;
      })()}</section>
    </div>

    <section className="section-head"><div><span className="eyebrow">Master schedule</span><h2>{items.length} scheduled items</h2></div></section>
    {items.length===0?<div className="state-card">Nothing has been scheduled yet. Match order still remains available in the fight card.</div>:<div className="schedule-board">{items.map(item=><article className="schedule-row" key={item.id}>
      <time><b>{new Date(item.startsAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</b><small>{new Date(item.endsAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small></time>
      <span className="status-pill">{rings.find(r=>r.id===item.ringId)?.name??'Venue'}</span>
      <div className="grow"><strong>{item.title}</strong><small>{item.itemType.replaceAll('_',' ')} · {item.status}{item.isPublic?' · public':' · staff only'}</small></div>
      {canManage&&<button disabled={busy} onClick={()=>remove(item)}>Remove</button>}
    </article>)}</div>}
    {message&&<div className="auth-message">{message}</div>}
  </>;
}
