import { useEffect, useState } from 'react';
import { useAppState } from '../features/AppState';
import { createRankingConfiguration, listRankingConfigurations, loadLatestRanking, rebuildRanking, type RankingDisplayEntry } from '../lib/rankingAdmin';
import { hasPermission } from '../lib/permissions';
import type { RankingConfiguration } from '../types';

export function RankingsEnginePage(){
  const {event,matches,roster,user}=useAppState();
  const [configs,setConfigs]=useState<RankingConfiguration[]>([]);
  const [configId,setConfigId]=useState('');
  const [rows,setRows]=useState<RankingDisplayEntry[]>([]);
  const [form,setForm]=useState({name:'Season Elo',disciplineKey:'',initialRating:1500,kFactor:32,provisionalKFactor:40,provisionalMatches:3,minimumMatches:1});
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const canManage=Boolean(event&&hasPermission(user,'ranking.manage',event.id,event.organizationId));
  const selected=configs.find(c=>c.id===configId);

  const refreshConfigs=async()=>{
    if(!event)return;
    const next=await listRankingConfigurations(event.organizationId,event.seasonId);
    setConfigs(next);
    const nextId=configId&&next.some(c=>c.id===configId)?configId:(next[0]?.id??'');
    setConfigId(nextId);
  };
  useEffect(()=>{refreshConfigs().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load ranking configurations.'));},[event?.organizationId,event?.seasonId]);
  useEffect(()=>{if(configId)loadLatestRanking(configId).then(setRows).catch(e=>setMessage(e instanceof Error?e.message:'Unable to load ranking snapshot.'));else setRows([]);},[configId]);
  if(!event)return <div className="state-card">No event selected.</div>;

  const create=async()=>{
    setBusy(true);setMessage('');
    try{
      const version=Math.max(0,...configs.filter(c=>c.name===form.name).map(c=>c.version))+1;
      const created=await createRankingConfiguration({
        organizationId:event.organizationId,seasonId:event.seasonId,name:form.name.trim(),scope:'season',disciplineKey:form.disciplineKey.trim()||undefined,version,
        formula:{type:'elo',initialRating:form.initialRating,kFactor:form.kFactor,provisionalKFactor:form.provisionalKFactor,provisionalMatches:form.provisionalMatches},
        minimumMatches:form.minimumMatches,isPublic:true
      });
      await refreshConfigs();setConfigId(created.id);setMessage(`Ranking formula version ${version} created.`);
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to create ranking configuration.');}finally{setBusy(false);}
  };

  const rebuild=async()=>{
    if(!selected)return;
    setBusy(true);setMessage('');
    try{const result=await rebuildRanking(selected,matches,roster);setRows(result);setMessage('Ranking rebuilt from finalized match history and published as a new snapshot.');}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to publish ranking.');}finally{setBusy(false);}
  };

  return <>
    <section className="section-head"><div><span className="eyebrow">Transparent rankings</span><h1>Ranking Engine</h1><p>Formulas are versioned. Published snapshots remain reproducible even after future methodology changes.</p></div>{canManage&&<div className="header-actions"><button className="primary" disabled={!selected||busy} onClick={rebuild}>Rebuild & Publish</button></div>}</section>

    <div className="admin-grid">
      <section className="panel-card"><h2>Methodology</h2><label className="form-stack">Ranking configuration<select value={configId} onChange={e=>setConfigId(e.target.value)}><option value="">Choose configuration</option>{configs.map(c=><option key={c.id} value={c.id}>{c.name} · v{c.version}{c.disciplineKey?` · ${c.disciplineKey}`:''}</option>)}</select></label>
        {selected?<div className="method-card"><div><span>Formula</span><b>{String(selected.formula.type??'unknown').toUpperCase()}</b></div><div><span>Initial rating</span><b>{String(selected.formula.initialRating??'—')}</b></div><div><span>K factor</span><b>{String(selected.formula.kFactor??'—')}</b></div><div><span>Minimum matches</span><b>{selected.minimumMatches}</b></div><div><span>Scope</span><b>{selected.scope}</b></div><div><span>Version</span><b>{selected.version}</b></div></div>:<div className="state-card">No ranking formula exists for this season.</div>}
      </section>

      {canManage&&<section className="panel-card"><h2>New formula version</h2><p>Creating a new version never rewrites an old snapshot.</p><div className="form-stack">
        <label>Name<input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></label>
        <label>Discipline key<input value={form.disciplineKey} onChange={e=>setForm(f=>({...f,disciplineKey:e.target.value}))} placeholder="Blank counts all ranked disciplines"/></label>
        <div className="form-grid"><label>Initial rating<input type="number" min="1" value={form.initialRating} onChange={e=>setForm(f=>({...f,initialRating:Number(e.target.value)}))}/></label><label>K factor<input type="number" min="1" value={form.kFactor} onChange={e=>setForm(f=>({...f,kFactor:Number(e.target.value)}))}/></label></div>
        <div className="form-grid"><label>Provisional K<input type="number" min="1" value={form.provisionalKFactor} onChange={e=>setForm(f=>({...f,provisionalKFactor:Number(e.target.value)}))}/></label><label>Provisional matches<input type="number" min="0" value={form.provisionalMatches} onChange={e=>setForm(f=>({...f,provisionalMatches:Number(e.target.value)}))}/></label></div>
        <label>Minimum matches for eligibility<input type="number" min="0" value={form.minimumMatches} onChange={e=>setForm(f=>({...f,minimumMatches:Number(e.target.value)}))}/></label>
        <button disabled={busy||!form.name.trim()} onClick={create}>Create Formula Version</button>
      </div></section>}
    </div>

    <section className="section-head"><div><span className="eyebrow">Published snapshot</span><h2>{selected?.name??'Ranking'} {selected?`v${selected.version}`:''}</h2></div></section>
    {rows.length===0?<div className="state-card">No ranking snapshot has been published for this configuration yet.</div>:<div className="table-wrap"><table><thead><tr><th>Rank</th><th>Fighter</th><th>Rating</th><th>Matches</th><th>Record</th><th>Movement</th><th>Status</th></tr></thead><tbody>{rows.map(row=>{
      const exp=row.explanation as {wins?:number;losses?:number;draws?:number};
      const movement=row.previousRank?row.previousRank-row.rank:0;
      return <tr key={row.competitorId}><td><strong>#{row.rank}</strong></td><td>{row.name}</td><td>{row.rating.toFixed(1)}</td><td>{row.matches}</td><td>{exp.wins??0}–{exp.losses??0}–{exp.draws??0}</td><td>{!row.previousRank?'New':movement===0?'—':movement>0?`↑${movement}`:`↓${Math.abs(movement)}`}</td><td><span className={`eligibility ${row.eligible?'ok':'blocked'}`}>{row.eligible?'RANKED':'PROVISIONAL'}</span></td></tr>;
    })}</tbody></table></div>}
    {message&&<div className="auth-message">{message}</div>}
  </>;
}
