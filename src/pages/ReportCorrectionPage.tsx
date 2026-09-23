import { useState } from 'react';
import { useAppState } from '../features/AppState';
import { submitCorrection } from '../lib/competitionAdmin';
import type { CorrectionRequest } from '../types';

const categories:CorrectionRequest['category'][]=['wrong_fighter','duplicate_fighter','wrong_team','incorrect_score','incorrect_affiliation','wrong_event','missing_event','incorrect_video','other'];

export function ReportCorrectionPage(){
  const {event,user}=useAppState();
  const [form,setForm]=useState({category:'other' as CorrectionRequest['category'],entityType:'',entityId:'',description:'',evidence:''});
  const [submitted,setSubmitted]=useState<string|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const submit=async()=>{
    if(form.description.trim().length<10)return setMessage('Please include enough detail for an administrator to understand the correction.');
    setBusy(true);setMessage('');
    try{
      const row=await submitCorrection({
        organizationId:event?.organizationId,eventId:event?.id,reporterUserId:user?.userId,category:form.category,
        entityType:form.entityType.trim()||undefined,entityId:form.entityId.trim()||undefined,description:form.description.trim(),
        evidenceLinks:form.evidence.split(/\n|,/).map(x=>x.trim()).filter(Boolean)
      });
      setSubmitted(row.id);
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to submit correction.');}finally{setBusy(false);}
  };
  return <main className="public-form-shell"><section className="registration-card">
    <span className="eyebrow">Data correction</span><h1>Report an incorrect record</h1>
    <p>BuhurtOS keeps official history auditable. Submit a correction instead of silently changing a historical result.</p>
    {submitted?<div className="success-box"><h2>Correction received</h2><p>Reference <code>{submitted}</code>. An authorized administrator can review the evidence and record the resolution.</p></div>:<div className="form-grid">
      <label>Issue type<select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value as CorrectionRequest['category']}))}>{categories.map(c=><option key={c} value={c}>{c.replaceAll('_',' ')}</option>)}</select></label>
      <label>Record type<input value={form.entityType} onChange={e=>setForm(f=>({...f,entityType:e.target.value}))} placeholder="fighter, match, team, event..."/></label>
      <label className="full">Record ID, if known<input value={form.entityId} onChange={e=>setForm(f=>({...f,entityId:e.target.value}))} placeholder="Optional UUID"/></label>
      <label className="full">What is wrong and what should it be?<textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Include names, event, match, score, or other identifying details."/></label>
      <label className="full">Evidence links <span className="hint">One per line or comma separated</span><textarea value={form.evidence} onChange={e=>setForm(f=>({...f,evidence:e.target.value}))} placeholder="Video, official bracket, event post, etc."/></label>
      <button className="primary big full" disabled={busy||form.description.trim().length<10} onClick={submit}>{busy?'Submitting…':'Submit Correction'}</button>
    </div>}
    {message&&<div className="auth-message">{message}</div>}
  </section></main>;
}
