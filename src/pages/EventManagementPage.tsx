import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import {
  createEventAnnouncement, createFightCard, deleteEventAnnouncement, listEventRegistrations,
  reviewRegistration, updateEventSettings, updateFightCard, updateRegistrationRoster,
  type EventRegistrationAdmin, type RegistrationReviewStatus
} from '../lib/eventAdmin';
import type { FightCard } from '../types';

const reviewStates: Array<{value: Exclude<RegistrationReviewStatus,'pending'>; label:string}> = [
  { value:'approved', label:'Approve' }, { value:'waitlisted', label:'Waitlist' },
  { value:'rejected', label:'Reject' }, { value:'withdrawn', label:'Withdraw' }
];

function toLocalInput(iso?:string):string {
  if(!iso)return '';
  const date=new Date(iso);
  if(Number.isNaN(date.getTime()))return '';
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function fromLocalInput(value:string):string|undefined {
  if(!value)return undefined;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?undefined:date.toISOString();
}

export function EventManagementPage(){
  const { event, announcements, fightCards, reload } = useAppState();
  const [registrations,setRegistrations]=useState<EventRegistrationAdmin[]>([]);
  const [tab,setTab]=useState<'settings'|'fields'|'registrations'|'announcements'>('settings');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [filter,setFilter]=useState<RegistrationReviewStatus|'all'>('all');
  const [settings,setSettings]=useState({
    name:'',venue:'',startsAt:'',endsAt:'',timezone:'UTC',status:'draft',
    eventType:'ranked_competitive',standingsMode:'season_and_event',registrationOpen:false,
    registrationOpensAt:'',registrationClosesAt:'',registrationCapacity:'',waitlistEnabled:true,
    publicDescription:'',livestreamUrl:''
  });
  const [announcement,setAnnouncement]=useState({title:'',body:'',isPublic:true,scheduledFor:''});
  const [newFieldName,setNewFieldName]=useState('');
  const [fieldDrafts,setFieldDrafts]=useState<Record<string,{name:string;status:FightCard['status']}>>({});
  const [reviewDrafts,setReviewDrafts]=useState<Record<string,{reason:string;notes:string}>>({});
  const [rosterDrafts,setRosterDrafts]=useState<Record<string,{teamName:string;members:string}>>({});

  const refreshRegistrations=async()=>{
    if(!event)return;
    setRegistrations(await listEventRegistrations(event.id));
  };

  useEffect(()=>{
    if(!event)return;
    setSettings({
      name:event.name,venue:event.venue,startsAt:toLocalInput(event.startsAt),endsAt:toLocalInput(event.endsAt),
      timezone:event.timezone,status:event.status,eventType:event.eventType,standingsMode:event.standingsMode,
      registrationOpen:Boolean(event.registrationOpen),registrationOpensAt:toLocalInput(event.registrationOpensAt),
      registrationClosesAt:toLocalInput(event.registrationClosesAt),registrationCapacity:event.registrationCapacity?.toString()??'',
      waitlistEnabled:event.waitlistEnabled??true,publicDescription:event.publicDescription??'',livestreamUrl:event.livestreamUrl??''
    });
    listEventRegistrations(event.id).then(rows=>{
      setRegistrations(rows);
      setReviewDrafts(Object.fromEntries(rows.map(row=>[row.id,{reason:row.eligibilityOverrideReason??'',notes:row.organizerNotes??''}])));
      setRosterDrafts(Object.fromEntries(rows.filter(row=>row.registrationKind==='team').map(row=>[row.id,{teamName:row.teamName??'',members:row.teamRoster.join('\n')}])));
    }).catch(error=>setMessage(error instanceof Error?error.message:'Unable to load registrations.'));
  },[event?.id]);

  useEffect(()=>setFieldDrafts(Object.fromEntries(fightCards.map(card=>[card.id,{name:card.name,status:card.status}]))),[fightCards]);

  const filtered=useMemo(()=>filter==='all'?registrations:registrations.filter(item=>item.status===filter),[registrations,filter]);
  const counts=useMemo(()=>registrations.reduce<Record<string,number>>((acc,item)=>{acc[item.status]=(acc[item.status]??0)+1;return acc;},{}),[registrations]);
  if(!event)return null;

  const saveSettings=async()=>{
    setBusy(true);setMessage('');
    try{
      const startsAt=fromLocalInput(settings.startsAt),endsAt=fromLocalInput(settings.endsAt);
      if(!startsAt||!endsAt)throw new Error('Valid event start and end times are required.');
      await updateEventSettings(event,{
        name:settings.name,venue:settings.venue,startsAt,endsAt,timezone:settings.timezone,
        status:settings.status as typeof event.status,eventType:settings.eventType as typeof event.eventType,
        standingsMode:settings.standingsMode as typeof event.standingsMode,registrationOpen:settings.registrationOpen,
        registrationOpensAt:fromLocalInput(settings.registrationOpensAt),registrationClosesAt:fromLocalInput(settings.registrationClosesAt),
        registrationCapacity:settings.registrationCapacity?Number(settings.registrationCapacity):undefined,
        waitlistEnabled:settings.waitlistEnabled,publicDescription:settings.publicDescription,livestreamUrl:settings.livestreamUrl
      });
      await reload();setMessage('Event settings saved.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to save event settings.');}
    finally{setBusy(false);}
  };

  const addField=async()=>{if(!newFieldName.trim())return;setBusy(true);setMessage('');try{await createFightCard(event.id,newFieldName,fightCards);setNewFieldName('');await reload();setMessage('Field created.');}catch(error){setMessage(error instanceof Error?error.message:'Unable to create field.');}finally{setBusy(false);}};
  const saveField=async(card:FightCard)=>{const draft=fieldDrafts[card.id];if(!draft)return;setBusy(true);setMessage('');try{await updateFightCard(event.id,card,draft,fightCards);await reload();setMessage('Field updated.');}catch(error){setMessage(error instanceof Error?error.message:'Unable to update field.');}finally{setBusy(false);}};

  const review=async(item:EventRegistrationAdmin,status:Exclude<RegistrationReviewStatus,'pending'>)=>{
    const draft=reviewDrafts[item.id]??{reason:'',notes:''};
    setBusy(true);setMessage('');
    try{
      await reviewRegistration(event,item.id,status,item.updatedAt,draft.reason,draft.notes);
      await refreshRegistrations();await reload();
      setMessage(status==='approved'?'Registration approved. Physical check in and marshal clearance are still required.':'Registration status updated.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to review registration.');}
    finally{setBusy(false);}
  };

  const saveRoster=async(item:EventRegistrationAdmin)=>{
    const draft=rosterDrafts[item.id];if(!draft)return;
    setBusy(true);setMessage('');
    try{
      const members=draft.members.split('\n').map(value=>value.trim()).filter(Boolean);
      await updateRegistrationRoster(item,draft.teamName,members,reviewDrafts[item.id]?.notes);
      await refreshRegistrations();setMessage('Team roster updated and eligibility rechecked.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to update team roster.');}
    finally{setBusy(false);}
  };

  const postAnnouncement=async()=>{if(!announcement.title.trim()||!announcement.body.trim())return;setBusy(true);setMessage('');try{await createEventAnnouncement(event.id,announcement);setAnnouncement({title:'',body:'',isPublic:true,scheduledFor:''});await reload();setMessage('Announcement saved.');}catch(error){setMessage(error instanceof Error?error.message:'Unable to save announcement.');}finally{setBusy(false);}};
  const removeAnnouncement=async(id:string)=>{setBusy(true);setMessage('');try{await deleteEventAnnouncement(event.id,id);await reload();setMessage('Announcement removed.');}catch(error){setMessage(error instanceof Error?error.message:'Unable to remove announcement.');}finally{setBusy(false);}};

  return <>
    <section className="section-head"><div><span className="eyebrow">Event command centre</span><h1>Manage {event.name}</h1><p>Govern event publishing, registration, fields, clearances and public communications.</p></div>
      <div className="header-actions"><button className={tab==='settings'?'primary':''} onClick={()=>setTab('settings')}>Settings</button><button className={tab==='fields'?'primary':''} onClick={()=>setTab('fields')}>Fields</button><button className={tab==='registrations'?'primary':''} onClick={()=>setTab('registrations')}>Registrations {registrations.length>0?'('+registrations.length+')':''}</button><button className={tab==='announcements'?'primary':''} onClick={()=>setTab('announcements')}>Announcements</button></div>
    </section>

    {tab==='settings'&&<div className="admin-grid">
      <section className="panel-card"><h2>Event lifecycle & schedule</h2><div className="form-stack">
        <label>Name<input value={settings.name} onChange={e=>setSettings(s=>({...s,name:e.target.value}))}/></label>
        <label>Venue<input value={settings.venue} onChange={e=>setSettings(s=>({...s,venue:e.target.value}))}/></label>
        <label>Starts <span className="hint">Your device local time</span><input type="datetime-local" value={settings.startsAt} onChange={e=>setSettings(s=>({...s,startsAt:e.target.value}))}/></label>
        <label>Ends <span className="hint">Your device local time</span><input type="datetime-local" value={settings.endsAt} onChange={e=>setSettings(s=>({...s,endsAt:e.target.value}))}/></label>
        <label>Event timezone<input value={settings.timezone} onChange={e=>setSettings(s=>({...s,timezone:e.target.value}))}/></label>
        <label>Status<select value={settings.status} onChange={e=>setSettings(s=>({...s,status:e.target.value}))}><option value="draft">Draft</option><option value="published">Published</option><option value="live">Live</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="archived">Archived</option></select></label>
        <label>Event type<select value={settings.eventType} onChange={e=>setSettings(s=>({...s,eventType:e.target.value}))}><option value="ranked_competitive">Ranked competitive</option><option value="demo_fun">Demo / fun</option><option value="exhibition">Exhibition</option><option value="clinic_training">Clinic / training</option><option value="custom">Custom</option></select></label>
        <label>Standings<select value={settings.standingsMode} onChange={e=>setSettings(s=>({...s,standingsMode:e.target.value}))}><option value="season_and_event">Season + event</option><option value="event_only">Event only</option><option value="no_standings">No standings</option></select></label>
      </div></section>
      <section className="panel-card"><h2>Registration & public view</h2><div className="form-stack">
        <label className="checkbox-line"><input type="checkbox" checked={settings.registrationOpen} onChange={e=>setSettings(s=>({...s,registrationOpen:e.target.checked}))}/><span>Registration open</span></label>
        <label>Registration opens<input type="datetime-local" value={settings.registrationOpensAt} onChange={e=>setSettings(s=>({...s,registrationOpensAt:e.target.value}))}/></label>
        <label>Registration closes<input type="datetime-local" value={settings.registrationClosesAt} onChange={e=>setSettings(s=>({...s,registrationClosesAt:e.target.value}))}/></label>
        <label>Overall approved-entry capacity<input inputMode="numeric" value={settings.registrationCapacity} onChange={e=>setSettings(s=>({...s,registrationCapacity:e.target.value}))} placeholder="Unlimited"/></label>
        <label className="checkbox-line"><input type="checkbox" checked={settings.waitlistEnabled} onChange={e=>setSettings(s=>({...s,waitlistEnabled:e.target.checked}))}/><span>Use waitlist when capacity is full</span></label>
        <label>Public description<textarea value={settings.publicDescription} onChange={e=>setSettings(s=>({...s,publicDescription:e.target.value}))}/></label>
        <label>Livestream URL<input value={settings.livestreamUrl} onChange={e=>setSettings(s=>({...s,livestreamUrl:e.target.value}))} placeholder="https://…"/></label>
        <button className="primary big" disabled={busy||event.status==='archived'} onClick={saveSettings}>Save Event Settings</button>
      </div></section>
    </div>}

    {tab==='fields'&&<div className="admin-grid">
      <section className="panel-card"><h2>Add tournament field</h2><p>Each field gets an independent fight queue and bullpen state.</p><div className="inline-form"><input value={newFieldName} onChange={e=>setNewFieldName(e.target.value)} placeholder="Field 2 / List B"/><button className="primary" disabled={busy||!newFieldName.trim()} onClick={addField}>Add Field</button></div></section>
      <section className="panel-card"><h2>Fields & lists</h2><div className="field-admin-list">{fightCards.length===0?<div className="state-card">No explicit fields yet.</div>:[...fightCards].sort((a,b)=>a.sortOrder-b.sortOrder).map(card=>{const draft=fieldDrafts[card.id]??{name:card.name,status:card.status};return <article key={card.id}><div className="form-stack grow"><label>Name<input value={draft.name} onChange={e=>setFieldDrafts(current=>({...current,[card.id]:{...draft,name:e.target.value}}))}/></label><label>Status<select value={draft.status} onChange={e=>setFieldDrafts(current=>({...current,[card.id]:{...draft,status:e.target.value as FightCard['status']}}))}><option value="draft">Draft</option><option value="live">Live</option><option value="locked">Locked</option><option value="archived">Archived</option></select></label></div><button disabled={busy} onClick={()=>saveField(card)}>Save</button></article>;})}</div></section>
    </div>}

    {tab==='registrations'&&<>
      <div className="registration-summary">{(['pending','approved','waitlisted','rejected','withdrawn'] as const).map(status=><button key={status} className={filter===status?'selected':''} onClick={()=>setFilter(status)}><b>{counts[status]??0}</b><span>{status}</span></button>)}<button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}><b>{registrations.length}</b><span>all</span></button></div>
      {filtered.length===0?<div className="state-card">No registrations match this filter.</div>:<div className="registration-review-list">{filtered.map(item=>{
        const draft=reviewDrafts[item.id]??{reason:'',notes:''};
        const rosterDraft=rosterDrafts[item.id]??{teamName:item.teamName??'',members:item.teamRoster.join('\n')};
        return <article className="panel-card" key={item.id}>
          <div className="registration-review-head"><div><span className="eyebrow">{item.category} · {item.registrationKind}</span><h3>{item.registrationKind==='team'?(item.teamName||item.displayName):item.displayName}</h3><p>{item.email}{item.phone?' · '+item.phone:''}</p></div><span className={'status-pill '+(item.status==='approved'?'ok':item.status==='pending'?'warn':'')}>{item.status}</span></div>
          <div className="registration-review-meta"><span><small>Eligibility</small><b>{item.eligibilityStatus.replaceAll('_',' ')}</b></span><span><small>Payment</small><b>{item.paymentStatus.replaceAll('_',' ')}</b></span><span><small>Waiver acknowledgement</small><b>{item.waiverAcknowledged?'Yes':'No'}</b></span><span><small>Waiver file</small><b>{item.waiverStoragePath?'Uploaded':'None'}</b></span></div>
          {item.eligibilityReasons.length>0&&<div className="validation-errors">{item.eligibilityReasons.map(reason=><div key={reason}>{reason}</div>)}</div>}
          {item.emergencyContact&&<div className="state-card"><b>Private emergency contact:</b> {item.emergencyContact}</div>}
          {item.registrationKind==='team'&&<div className="form-stack">
            <label>Team name<input value={rosterDraft.teamName} disabled={!['pending','waitlisted'].includes(item.status)} onChange={e=>setRosterDrafts(current=>({...current,[item.id]:{...rosterDraft,teamName:e.target.value}}))}/></label>
            <label>Team roster<textarea rows={Math.max(4,item.teamSize??4)} value={rosterDraft.members} disabled={!['pending','waitlisted'].includes(item.status)} onChange={e=>setRosterDrafts(current=>({...current,[item.id]:{...rosterDraft,members:e.target.value}}))}/></label>
            {['pending','waitlisted'].includes(item.status)&&<button disabled={busy} onClick={()=>saveRoster(item)}>Save Team Roster</button>}
          </div>}
          <div className="form-stack">
            {item.eligibilityStatus==='needs_review'&&<label>Eligibility approval reason<input value={draft.reason} onChange={e=>setReviewDrafts(current=>({...current,[item.id]:{...draft,reason:e.target.value}}))} placeholder="Required before approval"/></label>}
            <label>Organizer notes<textarea value={draft.notes} onChange={e=>setReviewDrafts(current=>({...current,[item.id]:{...draft,notes:e.target.value}}))}/></label>
          </div>
          <div className="header-actions">{reviewStates.map(action=><button key={action.value} className={action.value==='approved'?'primary':''} disabled={busy||item.status===action.value||(action.value==='approved'&&item.eligibilityStatus==='ineligible')||(action.value==='approved'&&item.eligibilityStatus==='needs_review'&&!draft.reason.trim())} onClick={()=>review(item,action.value)}>{action.label}</button>)}</div>
        </article>;
      })}</div>}
    </>}

    {tab==='announcements'&&<div className="admin-grid">
      <section className="panel-card"><h2>New announcement</h2><div className="form-stack"><label>Title<input value={announcement.title} onChange={e=>setAnnouncement(a=>({...a,title:e.target.value}))}/></label><label>Message<textarea value={announcement.body} onChange={e=>setAnnouncement(a=>({...a,body:e.target.value}))}/></label><label>Schedule for<input type="datetime-local" value={announcement.scheduledFor} onChange={e=>setAnnouncement(a=>({...a,scheduledFor:e.target.value}))}/></label><label className="checkbox-line"><input type="checkbox" checked={announcement.isPublic} onChange={e=>setAnnouncement(a=>({...a,isPublic:e.target.checked}))}/><span>Visible to spectators</span></label><button className="primary big" disabled={busy||!announcement.title.trim()||!announcement.body.trim()} onClick={postAnnouncement}>Save Announcement</button></div></section>
      <section className="panel-card"><h2>Event announcements</h2><div className="announcement-list">{announcements.length===0?<div className="state-card">No announcements yet.</div>:announcements.map(item=><article key={item.id}><div className="grow"><b>{item.title}</b><p>{item.body}</p><small>{item.isPublic?'Public':'Internal'}{item.scheduledFor?' · scheduled '+new Date(item.scheduledFor).toLocaleString():''}</small></div><button disabled={busy} onClick={()=>removeAnnouncement(item.id)}>Remove</button></article>)}</div></section>
    </div>}

    {message&&<div className="auth-message">{message}</div>}
  </>;
}
