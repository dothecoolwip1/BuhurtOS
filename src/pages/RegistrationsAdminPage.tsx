import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { listEventRegistrations, reviewEventRegistration, type RegistrationReviewRow, type RegistrationStatus } from '../lib/registrationAdmin';

const statuses:RegistrationStatus[]=['pending','approved','waitlisted','rejected','withdrawn'];

export function RegistrationsAdminPage(){
  const {event,user,reload}=useAppState();
  const [rows,setRows]=useState<RegistrationReviewRow[]>([]);
  const [statusFilter,setStatusFilter]=useState<'all'|RegistrationStatus>('all');
  const [query,setQuery]=useState('');
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState('');
  const canReview=Boolean(event&&user&&(
    user.platformRoles.includes('platform_super_admin')||
    user.organizationRoles.some(r=>r.organizationId===event.organizationId&&r.role==='organization_admin')||
    user.eventRoles.some(r=>r.eventId===event.id&&['event_organizer','tournament_director','registration_staff'].includes(r.role))
  ));

  const refresh=async()=>{if(event)setRows(await listEventRegistrations(event.id));};
  useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load registrations.'));},[event?.id]);
  if(!event)return <div className="state-card">No event selected.</div>;

  const visible=useMemo(()=>rows.filter(row=>{
    if(statusFilter!=='all'&&row.status!==statusFilter)return false;
    const hay=`${row.displayName} ${row.email} ${row.teamName??''} ${row.category}`.toLowerCase();
    return !query||hay.includes(query.toLowerCase());
  }),[rows,statusFilter,query]);

  const review=async(row:RegistrationReviewRow,status:RegistrationStatus)=>{
    if(!canReview)return;
    if(status==='rejected'&&!notes[row.id]?.trim())return setMessage('Add a rejection reason before rejecting the registration.');
    setBusy(row.id);setMessage('');
    try{
      await reviewEventRegistration(event.id,row.id,status,notes[row.id]);
      setNotes(n=>({...n,[row.id]:''}));
      await Promise.all([refresh(),reload()]);
      setMessage(`${row.displayName} is now ${status}.`);
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to review registration.');}
    finally{setBusy('');}
  };

  const counts=Object.fromEntries(statuses.map(status=>[status,rows.filter(r=>r.status===status).length]));

  return <>
    <section className="section-head"><div><span className="eyebrow">Registration desk</span><h1>Registrations</h1><p>Approve entrants, manage waitlists, and create event roster records without re-entering competitor information.</p></div><div className="header-actions"><span className="status-pill">{rows.length} total</span><span className="status-pill warn">{counts.pending??0} pending</span></div></section>
    <section className="panel-card registration-filters">
      <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, email, team, or division"/>
      <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">All statuses</option>{statuses.map(status=><option key={status} value={status}>{status} ({counts[status]??0})</option>)}</select>
    </section>
    <div className="registration-review-list">{visible.map(row=><article className="panel-card" key={row.id}>
      <div className="panel-title-row"><div><span className="eyebrow">{row.category}</span><h2>{row.displayName}</h2><small>{row.teamName??'Independent'} · submitted {new Date(row.createdAt).toLocaleString()}</small></div><span className={`validation-state ${row.status}`}>{row.status}</span></div>
      <div className="registration-facts"><span><small>Email</small><b>{row.email}</b></span><span><small>Payment</small><b>{row.paymentStatus.replaceAll('_',' ')}</b></span><span><small>Waiver</small><b>{row.waiverAcknowledged?'Acknowledged':'Missing'}</b></span></div>
      {canReview&&<><label className="form-stack">Review note<textarea value={notes[row.id]??row.reviewNotes??''} onChange={e=>setNotes(n=>({...n,[row.id]:e.target.value}))} placeholder="Reason, waitlist note, or approval note"/></label><div className="validation-actions">{statuses.filter(s=>s!==row.status).map(status=><button key={status} disabled={busy===row.id} onClick={()=>review(row,status)}>{status}</button>)}</div></>}
    </article>)}</div>
    {visible.length===0&&<div className="state-card">No registrations match this view.</div>}
    {message&&<div className="auth-message">{message}</div>}
  </>;
}
