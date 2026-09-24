import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import {
  claimFirstSuperAdmin, createEvent, createOrganization, createSeason, listEvents, listOrganizations,
  listSeasons, setOrganizationStatus, setSeasonStatus, updateOrganization, updateSeason,
  type SetupOrganization, type SetupSeason
} from '../lib/setup';
import { listRulesets } from '../lib/rulesetAdmin';
import { isSupabaseConfigured } from '../lib/supabase';
import type { RulesetRecord } from '../types';

const toIso=(value:string)=>new Date(value).toISOString();
const initialYear=new Date().getFullYear();
const openEvent=(eventId:string)=>{window.location.hash=`/ops?event=${encodeURIComponent(eventId)}`;};

export function SetupPage(){
  const {user}=useAppState();
  const [organizations,setOrganizations]=useState<SetupOrganization[]>([]);
  const [seasons,setSeasons]=useState<SetupSeason[]>([]);
  const [rulesets,setRulesets]=useState<RulesetRecord[]>([]);
  const [events,setEvents]=useState<Array<{id:string;name:string;venue:string;startsAt:string;status:string}>>([]);
  const [orgId,setOrgId]=useState('');
  const [seasonId,setSeasonId]=useState('');
  const [orgForm,setOrgForm]=useState({name:'',shortName:'',region:''});
  const [orgEdit,setOrgEdit]=useState({name:'',shortName:'',region:'',status:'active' as 'active'|'inactive'});
  const [seasonForm,setSeasonForm]=useState({name:`${initialYear} Season`,startsAt:`${initialYear}-01-01T09:00`,endsAt:`${initialYear}-12-31T18:00`});
  const [seasonEdit,setSeasonEdit]=useState({
    name:'',startsAt:'',endsAt:'',status:'draft' as SetupSeason['status'],defaultRulesetId:'',rankingPolicyText:'{}'
  });
  const [eventForm,setEventForm]=useState({
    name:'',venue:'',startsAt:'',endsAt:'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',
    eventType:'ranked_competitive',standingsMode:'season_and_event'
  });
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const platformAdmin=Boolean(user?.platformRoles.includes('platform_super_admin'));
  const canCreateOrg=platformAdmin;
  const selectedSeason=useMemo(()=>seasons.find(item=>item.id===seasonId),[seasons,seasonId]);
  const publishedRulesets=rulesets.filter(row=>row.status==='published');

  const refreshOrgs=async()=>{
    const rows=await listOrganizations();
    setOrganizations(rows);
    if(!orgId&&rows[0])setOrgId(rows[0].id);
  };
  const refreshOrgData=async(id:string)=>{
    const [seasonRows,eventRows,rulesetRows]=await Promise.all([listSeasons(id),listEvents(id),listRulesets(id)]);
    setSeasons(seasonRows);setEvents(eventRows);setRulesets(rulesetRows);
    setSeasonId(current=>current&&seasonRows.some(row=>row.id===current)?current:(seasonRows[0]?.id||''));
  };

  useEffect(()=>{if(user)refreshOrgs().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load organizations.'));},[user?.userId]);
  useEffect(()=>{
    const org=organizations.find(item=>item.id===orgId);
    if(org)setOrgEdit({name:org.name,shortName:org.shortName,region:org.region,status:org.status});
    if(!orgId){setSeasons([]);setEvents([]);setRulesets([]);return;}
    refreshOrgData(orgId).catch(e=>setMessage(e instanceof Error?e.message:'Unable to load organization setup.'));
  },[orgId,organizations.length]);
  useEffect(()=>{
    const season=seasons.find(item=>item.id===seasonId);
    if(!season)return;
    setSeasonEdit({
      name:season.name,startsAt:season.startsAt.slice(0,16),endsAt:season.endsAt.slice(0,16),
      status:season.status,defaultRulesetId:season.defaultRulesetId||'',
      rankingPolicyText:JSON.stringify(season.rankingPolicy??{},null,2)
    });
  },[seasonId,seasons]);

  if(!user)return <div className="state-card">Sign in before configuring BuhurtOS.</div>;
  if(!isSupabaseConfigured)return <div className="state-card">Demo mode already contains seeded hierarchy data. Connect a dedicated BuhurtOS Supabase project to use governed season setup.</div>;

  const run=async(work:()=>Promise<void>,success:string)=>{
    setBusy(true);setMessage('');
    try{await work();if(orgId)await refreshOrgData(orgId);setMessage(success);}
    catch(e){setMessage(e instanceof Error?e.message:'The requested setup change could not be completed.');}
    finally{setBusy(false);}
  };

  const claim=()=>run(async()=>{
    const claimed=await claimFirstSuperAdmin();
    if(!claimed)throw new Error('A platform administrator already exists. Ask that administrator to add you.');
    window.setTimeout(()=>window.location.reload(),500);
  },'This account is now the initial platform super admin. Reloading access…');

  const addOrg=()=>run(async()=>{
    if(!orgForm.name||!orgForm.shortName||!orgForm.region)throw new Error('Organization name, short name, and region are required.');
    const org=await createOrganization({...orgForm,userId:user.userId});
    await refreshOrgs();setOrgId(org.id);setOrgForm({name:'',shortName:'',region:''});
  },'Organization created and you were assigned organization admin.');

  const saveOrg=()=>run(async()=>{
    if(!orgId)throw new Error('Choose an organization.');
    await updateOrganization({id:orgId,...orgEdit});
    await refreshOrgs();
  },'Organization updated.');

  const toggleOrgStatus=()=>{
    if(!orgId)return;
    const next=orgEdit.status==='active'?'inactive':'active';
    if(next==='inactive'&&!window.confirm('Mark this organization inactive? Existing seasons, events, and history will be retained.'))return;
    return run(async()=>{await setOrganizationStatus(orgId,next);await refreshOrgs();},next==='inactive'?'Organization marked inactive.':'Organization reactivated.');
  };

  const addSeason=()=>run(async()=>{
    if(!orgId||!seasonForm.name)throw new Error('Choose an organization and enter a season name.');
    const season=await createSeason({
      organizationId:orgId,name:seasonForm.name,startsAt:toIso(seasonForm.startsAt),endsAt:toIso(seasonForm.endsAt),userId:user.userId
    });
    setSeasonId(season.id);
  },'Draft season created. Configure policy, then activate it when ready.');

  const saveSeason=()=>run(async()=>{
    if(!orgId||!seasonId||!selectedSeason)throw new Error('Choose a season.');
    let rankingPolicy:Record<string,unknown>;
    try{rankingPolicy=JSON.parse(seasonEdit.rankingPolicyText) as Record<string,unknown>;}
    catch{throw new Error('Ranking policy must be valid JSON.');}
    await updateSeason({
      id:seasonId,organizationId:orgId,name:seasonEdit.name,startsAt:toIso(seasonEdit.startsAt),
      endsAt:toIso(seasonEdit.endsAt),expectedUpdatedAt:selectedSeason.updatedAt,
      defaultRulesetId:seasonEdit.defaultRulesetId||undefined,rankingPolicy
    });
  },'Season policy saved.');

  const changeSeasonStatus=(status:'active'|'archived')=>{
    if(!orgId||!seasonId||!selectedSeason)return;
    if(status==='archived'&&!window.confirm('Archive this season? All events must already be completed or archived. Historical standings remain intact.'))return;
    return run(
      ()=>setSeasonStatus(orgId,seasonId,status,selectedSeason.updatedAt),
      status==='active'?'Season activated.':'Season archived and locked against historical rewrites.'
    );
  };

  const addEvent=()=>run(async()=>{
    if(!orgId||!seasonId||!eventForm.name||!eventForm.venue||!eventForm.startsAt||!eventForm.endsAt)throw new Error('Complete the event fields first.');
    const eventId=await createEvent({
      organizationId:orgId,seasonId,name:eventForm.name,venue:eventForm.venue,
      startsAt:toIso(eventForm.startsAt),endsAt:toIso(eventForm.endsAt),timezone:eventForm.timezone,
      eventType:eventForm.eventType as any,standingsMode:eventForm.standingsMode as any,userId:user.userId
    });
    openEvent(eventId);
  },'Event created.');

  return <>
    <section className="section-head"><div><span className="eyebrow">Organizations & governed seasons</span><h1>BuhurtOS Setup</h1><p>Build organization, season, and event boundaries without rewriting historical competition policy later.</p></div></section>
    {!platformAdmin&&user.organizationRoles.length===0&&<section className="panel-card setup-callout"><h2>Bootstrap first administrator</h2><p>Only a brand-new BuhurtOS database can claim this one-time platform administrator role.</p><button className="primary" disabled={busy} onClick={claim}>Claim First Platform Admin</button></section>}
    <div className="admin-grid">
      <section className="panel-card"><h2>Organization</h2>
        <label className="form-stack">Current organization<select value={orgId} onChange={e=>{setOrgId(e.target.value);setSeasonId('');}}><option value="">Choose organization</option>{organizations.map(org=><option value={org.id} key={org.id}>{org.name}{org.status==='inactive'?' · inactive':''}</option>)}</select></label>
        {orgId&&<div className="form-stack setup-subform"><input value={orgEdit.name} onChange={e=>setOrgEdit(f=>({...f,name:e.target.value}))}/><input value={orgEdit.shortName} onChange={e=>setOrgEdit(f=>({...f,shortName:e.target.value}))}/><input value={orgEdit.region} onChange={e=>setOrgEdit(f=>({...f,region:e.target.value}))}/><button onClick={saveOrg} disabled={busy}>Save Organization</button><button onClick={toggleOrgStatus} disabled={busy}>{orgEdit.status==='active'?'Mark Inactive':'Reactivate'}</button></div>}
        {canCreateOrg&&<div className="form-stack setup-subform"><h3>Create organization</h3><input placeholder="Organization name" value={orgForm.name} onChange={e=>setOrgForm(f=>({...f,name:e.target.value}))}/><input placeholder="Short name" value={orgForm.shortName} onChange={e=>setOrgForm(f=>({...f,shortName:e.target.value}))}/><input placeholder="Region" value={orgForm.region} onChange={e=>setOrgForm(f=>({...f,region:e.target.value}))}/><button onClick={addOrg} disabled={busy}>Create Organization</button></div>}
      </section>

      <section className="panel-card"><h2>Season</h2>
        <label className="form-stack">Current season<select value={seasonId} onChange={e=>setSeasonId(e.target.value)}><option value="">Choose season</option>{seasons.map(season=><option value={season.id} key={season.id}>{season.name} · {season.status}</option>)}</select></label>
        {selectedSeason&&<div className="form-stack setup-subform">
          <input disabled={selectedSeason.status==='archived'} value={seasonEdit.name} onChange={e=>setSeasonEdit(f=>({...f,name:e.target.value}))}/>
          <label>Starts<input disabled={selectedSeason.status==='archived'} type="datetime-local" value={seasonEdit.startsAt} onChange={e=>setSeasonEdit(f=>({...f,startsAt:e.target.value}))}/></label>
          <label>Ends<input disabled={selectedSeason.status==='archived'} type="datetime-local" value={seasonEdit.endsAt} onChange={e=>setSeasonEdit(f=>({...f,endsAt:e.target.value}))}/></label>
          <label>Default published ruleset<select disabled={selectedSeason.status==='archived'} value={seasonEdit.defaultRulesetId} onChange={e=>setSeasonEdit(f=>({...f,defaultRulesetId:e.target.value}))}><option value="">No default</option>{publishedRulesets.map(row=><option key={row.id} value={row.id}>{row.shortName} {row.version}</option>)}</select></label>
          <label>Season ranking policy<textarea disabled={selectedSeason.status==='archived'} rows={6} value={seasonEdit.rankingPolicyText} onChange={e=>setSeasonEdit(f=>({...f,rankingPolicyText:e.target.value}))}/></label>
          <small>Ranking policy is stored separately from scoring and tournament rules.</small>
          {selectedSeason.status!=='archived'&&<button onClick={saveSeason} disabled={busy}>Save Season Policy</button>}
          {selectedSeason.status==='draft'&&<button className="primary" onClick={()=>changeSeasonStatus('active')} disabled={busy}>Activate Season</button>}
          {selectedSeason.status!=='archived'&&<button onClick={()=>changeSeasonStatus('archived')} disabled={busy}>Archive Season</button>}
          {selectedSeason.status==='archived'&&<div className="state-card">Archived seasons are immutable. Events and standings remain preserved.</div>}
        </div>}
        {orgId&&<div className="form-stack setup-subform"><h3>Create draft season</h3><input value={seasonForm.name} onChange={e=>setSeasonForm(f=>({...f,name:e.target.value}))}/><label>Starts<input type="datetime-local" value={seasonForm.startsAt} onChange={e=>setSeasonForm(f=>({...f,startsAt:e.target.value}))}/></label><label>Ends<input type="datetime-local" value={seasonForm.endsAt} onChange={e=>setSeasonForm(f=>({...f,endsAt:e.target.value}))}/></label><button onClick={addSeason} disabled={busy}>Create Draft Season</button></div>}
      </section>

      <section className="panel-card"><h2>New event</h2>
        <p>Event dates must fall inside the selected season. The database rejects cross-season or archived-season mistakes.</p>
        <div className="form-stack"><input placeholder="Event name" value={eventForm.name} onChange={e=>setEventForm(f=>({...f,name:e.target.value}))}/><input placeholder="Venue" value={eventForm.venue} onChange={e=>setEventForm(f=>({...f,venue:e.target.value}))}/><label>Starts<input type="datetime-local" value={eventForm.startsAt} onChange={e=>setEventForm(f=>({...f,startsAt:e.target.value}))}/></label><label>Ends<input type="datetime-local" value={eventForm.endsAt} onChange={e=>setEventForm(f=>({...f,endsAt:e.target.value}))}/></label><label>Timezone<input value={eventForm.timezone} onChange={e=>setEventForm(f=>({...f,timezone:e.target.value}))}/></label><label>Event type<select value={eventForm.eventType} onChange={e=>setEventForm(f=>({...f,eventType:e.target.value}))}><option value="ranked_competitive">Ranked competitive</option><option value="demo_fun">Demo / fun</option><option value="exhibition">Exhibition</option><option value="clinic_training">Clinic / training</option><option value="custom">Custom</option></select></label><label>Standings<select value={eventForm.standingsMode} onChange={e=>setEventForm(f=>({...f,standingsMode:e.target.value}))}><option value="season_and_event">Season + event</option><option value="event_only">Event only</option><option value="no_standings">No standings</option></select></label><button className="primary" onClick={addEvent} disabled={busy||!selectedSeason||selectedSeason.status==='archived'}>Create Event</button></div>
      </section>

      <section className="panel-card"><h2>Existing events</h2><div className="membership-list">{events.length===0?<div className="state-card">No events in this organization yet.</div>:events.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{item.venue} · {item.status}</small></div><button onClick={()=>openEvent(item.id)}>Open</button></article>)}</div></section>
    </div>
    {message&&<div className="auth-message" role="status">{message}</div>}
  </>;
}
