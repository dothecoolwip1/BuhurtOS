import { useState } from 'react';
import { useAppState } from '../features/AppState';
import { hasPermission } from '../lib/permissions';
import { setMatchValidationStatus } from '../lib/resultValidation';
import type { MatchRecord, ValidationStatus } from '../types';

const workflow:ValidationStatus[]=['submitted','pending_validation','validated','disputed','corrected','final'];

export function ValidationPage(){
  const {event,matches,roster,user,reload}=useAppState();
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState('');
  const [reasons,setReasons]=useState<Record<string,string>>({});
  const canValidate=Boolean(event&&hasPermission(user,'result.validate',event.id,event.organizationId));
  if(!event)return <div className="state-card">No event selected.</div>;
  const finalized=matches.filter(m=>m.status==='finalized').sort((a,b)=>b.scheduledOrder-a.scheduledOrder);
  const name=(match:MatchRecord,side:1|2)=>{
    const participant=match.participants.find(p=>p.sideIndex===side);
    return roster.find(r=>r.id===participant?.rosterEntryId)?.displayName??participant?.placeholderLabel??'TBD';
  };
  const apply=async(match:MatchRecord,status:ValidationStatus)=>{
    setBusy(match.id);setMessage('');
    try{
      await setMatchValidationStatus(match,status,reasons[match.id]);
      setReasons(current=>({...current,[match.id]:''}));
      await reload();
      setMessage(`${match.label} marked ${status.replaceAll('_',' ')}.`);
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to change validation status.');}finally{setBusy('');}
  };
  return <>
    <section className="section-head"><div><span className="eyebrow">Official records</span><h1>Result Validation</h1><p>Scoring and historical acceptance are separate. Finalized scores enter a review workflow and every validation transition is preserved.</p></div><div className="header-actions"><span className="status-pill">{finalized.length} finalized scores</span></div></section>
    {finalized.length===0?<div className="state-card">No finalized matches are waiting for validation.</div>:<div className="validation-board">{finalized.map(match=>{
      const current=match.validationStatus??'in_progress';
      const result=match.resultSummary;
      const needsReason=['disputed','corrected'].includes(current);
      return <article className="panel-card" key={match.id}>
        <div className="panel-title-row"><div><span className="eyebrow">{match.category}</span><h2>{match.label}</h2></div><span className={`validation-state ${current}`}>{current.replaceAll('_',' ')}</span></div>
        <div className="validation-result"><strong>{name(match,1)}</strong><span>{result?`${result.side1Total} : ${result.side2Total}`:'No score'}</span><strong>{name(match,2)}</strong></div>
        {result&&<small>{result.winnerSide?`${name(match,result.winnerSide)} recorded as winner`:'Recorded draw'} · {result.resultType.replaceAll('_',' ')}</small>}
        {canValidate&&<>
          <label className="form-stack">Reason or reviewer note<input value={reasons[match.id]??''} onChange={e=>setReasons(current=>({...current,[match.id]:e.target.value}))} placeholder={needsReason?'Required to dispute or correct':'Optional unless disputing/correcting'}/></label>
          <div className="validation-actions">{workflow.map(status=>{
            const disabled=busy===match.id||status===current||(status==='final'&&!['validated','corrected'].includes(current))||((status==='disputed'||status==='corrected')&&!reasons[match.id]?.trim());
            return <button key={status} disabled={disabled} className={status===current?'selected':''} onClick={()=>apply(match,status)}>{status.replaceAll('_',' ')}</button>;
          })}</div>
        </>}
      </article>;
    })}</div>}
    {message&&<div className="auth-message">{message}</div>}
  </>;
}
