import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import {
  createEventAnnouncement,
  deleteEventAnnouncement,
  listEventRegistrations,
  reviewRegistration,
  updateEventSettings,
  type EventRegistrationAdmin,
  type RegistrationReviewStatus
} from '../lib/eventAdmin';

const reviewStates: Array<{value: Exclude<RegistrationReviewStatus,'pending'>; label:string}> = [
  { value:'approved', label:'Approve' },
  { value:'waitlisted', label:'Waitlist' },
  { value:'rejected', label:'Reject' },
  { value:'withdrawn', label:'Withdraw' }
];

export function EventManagementPage(){
  const { event, announcements, reload } = useAppState();
  const [registrations,setRegistrations]=useState<EventRegistrationAdmin[]>([]);
  const [tab,setTab]=useState<'settings'|'registrations'|'announcements'>('settings');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [filter,setFilter]=useState<RegistrationReviewStatus|'all'>('all');
  const [settings,setSettings]=useState({status:'draft',eventType:'ranked_competitive',standingsMode:'season_and_event',registrationOpen:false,livestreamUrl:''});
  const [announcement,setAnnouncement]=useState({title:'',body:'',isPublic:true,scheduledFor:''});

  useEffect(()=>{
    if(!event)return;
    setSettings({
      status:event.status,
      eventType:event.eventType,
      standingsMode:event.standingsMode,
      registrationOpen:Boolean(event.registrationOpen),
      livestreamUrl:event.livestreamUrl ?? ''
    });
    listEventRegistrations(event.id).then(setRegistrations).catch(error=>setMessage(error instanceof Error?error.message:'Unable to load registrations.'));
  },[event?.id]);

  const filtered=useMemo(()=>filter==='all'?registrations:registrations.filter(item=>item.status===filter),[registrations,filter]);
  const counts=useMemo(()=>registrations.reduce<Record<string,number>>((acc,item)=>{acc[item.status]=(acc[item.status]??0)+1;return acc;},{}),[registrations]);
  if(!event)return null;

  const saveSettings=async()=>{
    setBusy(true);setMessage('');
    try{
      await updateEventSettings(event,{
        status:settings.status as typeof event.status,
        eventType:settings.eventType as typeof event.eventType,
        standingsMode:settings.standingsMode as typeof event.standingsMode,
        registrationOpen:settings.registrationOpen,
        livestreamUrl:settings.livestreamUrl
      });
      await reload();
      setMessage('Event settings saved.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to save event settings.');}
    finally{setBusy(false);}
  };

  const review=async(id:string,status:Exclude<RegistrationReviewStatus,'pending'>)=>{
    setBusy(true);setMessage('');
    try{
      await reviewRegistration(event,id,status);
      setRegistrations(await listEventRegistrations(event.id));
      await reload();
      setMessage(status==='approved'?'Registration approved and added to the event roster.':'Registration status updated.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to review registration.');}
    finally{setBusy(false);}
  };

  const postAnnouncement=async()=>{
    if(!announcement.title.trim()||!announcement.body.trim())return;
    setBusy(true);setMessage('');
    try{
      await createEventAnnouncement(event.id,announcement);
      setAnnouncement({title:'',body:'',isPublic:true,scheduledFor:''});
      await reload();
      setMessage('Announcement saved.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to save announcement.');}
    finally{setBusy(false);}
  };

  const removeAnnouncement=async(id:string)=>{
    setBusy(true);setMessage('');
    try{await deleteEventAnnouncement(event.id,id);await reload();setMessage('Announcement removed.');}
    catch(error){setMessage(error instanceof Error?error.message:'Unable to remove announcement.');}
    finally{setBusy(false);}
  };

  return <>
    <section className="section-head">
      <div><span className="eyebrow">Event command centre</span><h1>Manage {event.name}</h1><p>Control publishing, registration intake, livestreaming, standings behaviour and event announcements.</p></div>
      <div className="header-actions"><button className={tab==='settings'?'primary':''} onClick={()=>setTab('settings')}>Settings</button><button className={tab==='registrations'?'primary':''} onClick={()=>setTab('registrations')}>Registrations {registrations.length>0?'('+registrations.length+')':''}</button><button className={tab==='announcements'?'primary':''} onClick={()=>setTab('announcements')}>Announcements</button></div>
    </section>

    {tab==='settings'&&<div className="admin-grid">
      <section className="panel-card"><h2>Event state</h2><div className="form-stack">
        <label>Status<select value={settings.status} onChange={e=>setSettings(s=>({...s,status:e.target.value}))}><option value="draft">Draft</option><option value="published">Published</option><option value="live">Live</option><option value="completed">Completed</option><option value="archived">Archived</option></select></label>
        <label>Event type<select value={settings.eventType} onChange={e=>setSettings(s=>({...s,eventType:e.target.value}))}><option value="ranked_competitive">Ranked competitive</option><option value="demo_fun">Demo / fun</option><option value="exhibition">Exhibition</option><option value="clinic_training">Clinic / training</option><option value="custom">Custom</option></select></label>
        <label>Standings<select value={settings.standingsMode} onChange={e=>setSettings(s=>({...s,standingsMode:e.target.value}))}><option value="season_and_event">Season + event</option><option value="event_only">Event only</option><option value="no_standings">No standings</option></select></label>
      </div></section>
      <section className="panel-card"><h2>Public access</h2><div className="form-stack">
        <label className="checkbox-line"><input type="checkbox" checked={settings.registrationOpen} onChange={e=>setSettings(s=>({...s,registrationOpen:e.target.checked}))}/><span>Registration open</span></label>
        <label>Livestream URL<input value={settings.livestreamUrl} onChange={e=>setSettings(s=>({...s,livestreamUrl:e.target.value}))} placeholder="YouTube, Twitch, or supported stream URL"/></label>
        <button className="primary big" disabled={busy} onClick={saveSettings}>Save Event Settings</button>
      </div></section>
    </div>}

    {tab==='registrations'&&<>
      <div className="registration-summary">
        {(['pending','approved','waitlisted','rejected','withdrawn'] as const).map(status=><button key={status} className={filter===status?'selected':''} onClick={()=>setFilter(status)}><b>{counts[status]??0}</b><span>{status}</span></button>)}
        <button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}><b>{registrations.length}</b><span>all</span></button>
      </div>
      {filtered.length===0?<div className="state-card">No registrations match this filter.</div>:<div className="registration-review-list">{filtered.map(item=><article className="panel-card" key={item.id}>
        <div className="registration-review-head"><div><span className="eyebrow">{item.category}</span><h3>{item.displayName}</h3><p>{item.teamName||'Independent / no team supplied'} · {item.email}</p></div><span className={'status-pill '+(item.status==='approved'?'ok':item.status==='pending'?'warn':'')}>{item.status}</span></div>
        <div className="registration-review-meta"><span><small>Payment</small><b>{item.paymentStatus.replaceAll('_',' ')}</b></span><span><small>Waiver</small><b>{item.waiverAcknowledged?'Acknowledged':'Missing'}</b></span><span><small>File</small><b>{item.waiverStoragePath?'Uploaded':'None'}</b></span><span><small>Received</small><b>{new Date(item.createdAt).toLocaleDateString()}</b></span></div>
        <div className="header-actions">{reviewStates.map(action=><button key={action.value} className={action.value==='approved'?'primary':''} disabled={busy||item.status===action.value} onClick={()=>review(item.id,action.value)}>{action.label}</button>)}</div>
      </article>)}</div>}
    </>}

    {tab==='announcements'&&<div className="admin-grid">
      <section className="panel-card"><h2>New announcement</h2><div className="form-stack">
        <label>Title<input value={announcement.title} onChange={e=>setAnnouncement(a=>({...a,title:e.target.value}))}/></label>
        <label>Message<textarea value={announcement.body} onChange={e=>setAnnouncement(a=>({...a,body:e.target.value}))}/></label>
        <label>Schedule for<input type="datetime-local" value={announcement.scheduledFor} onChange={e=>setAnnouncement(a=>({...a,scheduledFor:e.target.value}))}/></label>
        <label className="checkbox-line"><input type="checkbox" checked={announcement.isPublic} onChange={e=>setAnnouncement(a=>({...a,isPublic:e.target.checked}))}/><span>Visible to spectators</span></label>
        <button className="primary big" disabled={busy||!announcement.title.trim()||!announcement.body.trim()} onClick={postAnnouncement}>Save Announcement</button>
      </div></section>
      <section className="panel-card"><h2>Event announcements</h2><div className="announcement-list">{announcements.length===0?<div className="state-card">No announcements yet.</div>:announcements.map(item=><article key={item.id}><div className="grow"><b>{item.title}</b><p>{item.body}</p><small>{item.isPublic?'Public':'Internal'}{item.scheduledFor?' · scheduled '+new Date(item.scheduledFor).toLocaleString():''}</small></div><button disabled={busy} onClick={()=>removeAnnouncement(item.id)}>Remove</button></article>)}</div></section>
    </div>}

    {message&&<div className="auth-message">{message}</div>}
  </>;
}
