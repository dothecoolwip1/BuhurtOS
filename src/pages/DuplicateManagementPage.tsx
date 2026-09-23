import { useEffect, useState } from 'react';
import { useAppState } from '../features/AppState';
import { findIdentityDuplicates, listIdentityFighters, mergeFighterIdentity, type IdentityFighter } from '../lib/identityAdmin';
import type { DuplicateCandidate } from '../lib/duplicates';

type Candidate={candidate:DuplicateCandidate;left:IdentityFighter;right:IdentityFighter};

export function DuplicateManagementPage(){
  const {event}=useAppState();
  const [fighters,setFighters]=useState<IdentityFighter[]>([]);
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [selected,setSelected]=useState<Candidate|null>(null);
  const [targetId,setTargetId]=useState('');
  const [reason,setReason]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  const refresh=async()=>{
    if(!event)return;
    const [fighterRows,duplicateRows]=await Promise.all([listIdentityFighters(event.organizationId),findIdentityDuplicates(event.organizationId)]);
    setFighters(fighterRows);setCandidates(duplicateRows);
  };
  useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:'Unable to inspect duplicate identities.'));},[event?.organizationId]);
  if(!event)return <div className="state-card">No event selected.</div>;

  const choose=(row:Candidate)=>{
    setSelected(row);setTargetId(row.left.userId&&!row.right.userId?row.left.id:row.right.userId&&!row.left.userId?row.right.id:row.left.id);setReason('');
  };
  const merge=async()=>{
    if(!selected||!targetId||!reason.trim())return;
    const sourceId=targetId===selected.left.id?selected.right.id:selected.left.id;
    const source=sourceId===selected.left.id?selected.left:selected.right;
    const target=targetId===selected.left.id?selected.left:selected.right;
    if(!window.confirm(`Merge "${source.name}" into "${target.name}"? The source profile will be retired and its sporting history will move to the target. This action is audited.`))return;
    setBusy(true);setMessage('');
    try{await mergeFighterIdentity(sourceId,targetId,reason);setSelected(null);await refresh();setMessage('Fighter profiles merged and history preserved.');}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to merge fighter profiles.');}finally{setBusy(false);}
  };

  return <>
    <section className="section-head"><div><span className="eyebrow">Identity integrity</span><h1>Duplicate Management</h1><p>Similarity only creates review candidates. BuhurtOS never merges athletes automatically.</p></div><div className="header-actions"><span className="status-pill">{fighters.filter(f=>f.active).length} active fighters</span></div></section>
    {candidates.length===0?<div className="state-card"><strong>No likely duplicates detected</strong><p>Names are compared after punctuation and spacing normalization, with team context used only as supporting evidence.</p></div>:<div className="duplicate-grid">{candidates.map(row=><article className="panel-card" key={row.left.id+row.right.id}>
      <div className="panel-title-row"><div><span className="eyebrow">{Math.round(row.candidate.score*100)}% similarity</span><h2>Possible duplicate</h2></div><button className="primary" onClick={()=>choose(row)}>Review</button></div>
      <div className="duplicate-pair"><div><strong>{row.left.name}</strong><small>{row.left.teamId??'No team'}{row.left.userId?' · claimed':''}</small><code>{row.left.id}</code></div><span>↔</span><div><strong>{row.right.name}</strong><small>{row.right.teamId??'No team'}{row.right.userId?' · claimed':''}</small><code>{row.right.id}</code></div></div>
      <small>{row.candidate.reasons.join(' · ')}</small>
    </article>)}</div>}

    {selected&&<div className="dialog-backdrop" role="presentation" onMouseDown={e=>e.currentTarget===e.target&&setSelected(null)}><section className="dialog" role="dialog" aria-modal="true" aria-label="Review duplicate fighter">
      <div className="dialog-head"><div><span className="eyebrow">Identity merge</span><h2>Choose the permanent profile</h2></div><button className="icon-btn" onClick={()=>setSelected(null)}>×</button></div>
      <p>The other profile will remain in merge history but no longer appear as an active fighter. Claimed profiles are favored, and two profiles claimed by different accounts cannot be merged here.</p>
      <div className="merge-choice">
        {[selected.left,selected.right].map(fighter=><label className={targetId===fighter.id?'selected':''} key={fighter.id}><input type="radio" name="target" checked={targetId===fighter.id} onChange={()=>setTargetId(fighter.id)}/><span><b>{fighter.name}</b><small>{fighter.userId?'Claimed profile':'Unclaimed profile'} · {fighter.id}</small></span><strong>{targetId===fighter.id?'KEEP':'MERGE'}</strong></label>)}
      </div>
      <label className="form-stack">Merge reason<textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explain why these records represent the same fighter."/></label>
      <div className="dialog-actions"><button onClick={()=>setSelected(null)}>Cancel</button><button className="primary" disabled={busy||!targetId||!reason.trim()} onClick={merge}>{busy?'Merging…':'Merge Profiles'}</button></div>
    </section></div>}
    {message&&<div className="auth-message">{message}</div>}
  </>;
}
