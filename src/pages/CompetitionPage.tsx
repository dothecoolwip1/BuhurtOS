import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { checkCompliance } from '../lib/compliance';
import { computePoolStandings, type PoolSeed, type PoolTieBreaker } from '../lib/pools';
import { createEventDivision, listEventDivisions, listPools, saveGeneratedPools } from '../lib/competitionAdmin';
import { hasPermission } from '../lib/permissions';
import type { EventDivision, PoolEntryRecord, PoolRecord } from '../types';

type PoolWithEntries=PoolRecord & {entries:PoolEntryRecord[]};

export function CompetitionPage(){
  const {event,roster,matches,user}=useAppState();
  const [divisions,setDivisions]=useState<EventDivision[]>([]);
  const [divisionId,setDivisionId]=useState('');
  const [pools,setPools]=useState<PoolWithEntries[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [poolCount,setPoolCount]=useState(2);
  const [advancementCount,setAdvancementCount]=useState(2);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [newDivision,setNewDivision]=useState({name:'',disciplineKey:''});
  const canManage=Boolean(event&&hasPermission(user,'bracket.manage',event.id,event.organizationId));

  const eligible=useMemo(()=>roster.filter(entry=>checkCompliance(entry).eligible),[roster]);
  const selectedDivision=divisions.find(d=>d.id===divisionId);

  const refresh=async()=>{
    if(!event)return;
    const rows=await listEventDivisions(event.id);
    setDivisions(rows);
    const nextId=divisionId&&rows.some(d=>d.id===divisionId)?divisionId:(rows[0]?.id??'');
    if(nextId!==divisionId)setDivisionId(nextId);
    setPools(nextId?await listPools(event.id,nextId):[]);
  };

  useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load competition setup.'));},[event?.id]);
  useEffect(()=>{
    if(!event||!divisionId){setPools([]);return;}
    listPools(event.id,divisionId).then(setPools).catch(e=>setMessage(e instanceof Error?e.message:'Unable to load pools.'));
  },[divisionId,event?.id]);
  useEffect(()=>{setSelected(eligible.map(e=>e.id));},[event?.id,eligible.length]);

  if(!event)return <div className="state-card">No event selected.</div>;

  const addDivision=async()=>{
    if(!newDivision.name.trim()||!newDivision.disciplineKey.trim())return;
    setBusy(true);setMessage('');
    try{
      const created=await createEventDivision(event.id,{name:newDivision.name.trim(),disciplineKey:newDivision.disciplineKey.trim(),sortOrder:divisions.length+1});
      setNewDivision({name:'',disciplineKey:''});await refresh();setDivisionId(created.id);setMessage('Division created.');
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to create division.');}finally{setBusy(false);}
  };

  const generate=async()=>{
    if(!divisionId)return setMessage('Choose a division first.');
    const chosen=eligible.filter(entry=>selected.includes(entry.id));
    if(chosen.length<2)return setMessage('Select at least two cleared competitors.');
    if(poolCount>chosen.length)return setMessage('Pool count cannot exceed selected competitors.');
    setBusy(true);setMessage('');
    try{
      const seeds:PoolSeed[]=chosen.map((entry,index)=>({entry,seed:index+1}));
      const saved=await saveGeneratedPools({eventId:event.id,divisionId,entries:seeds,poolCount,advancementCount});
      setPools(saved);setMessage('Pools generated and saved. Existing competition results were protected.');
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to generate pools.');}finally{setBusy(false);}
  };

  const standingsFor=(pool:PoolWithEntries)=>{
    const seeds=pool.entries.map(item=>{
      const entry=roster.find(r=>r.id===item.rosterEntryId);
      return entry?{entry,seed:item.seed}:null;
    }).filter((x):x is PoolSeed=>Boolean(x));
    const config=pool.standingsConfig??{};
    return computePoolStandings({
      entries:seeds,
      matches:matches.filter(m=>!m.poolId||m.poolId===pool.id),
      winPoints:config.winPoints,
      drawPoints:config.drawPoints,
      tieBreakers:(config.tieBreakers as PoolTieBreaker[]|undefined)
    });
  };

  return <>
    <section className="section-head">
      <div><span className="eyebrow">Competition structure</span><h1>Divisions & Pools</h1><p>Configure disciplines, seed cleared competitors, separate teammates where practical, and calculate advancement from finalized match data.</p></div>
      <div className="header-actions"><span className="status-pill">{eligible.length} cleared</span></div>
    </section>

    <div className="admin-grid">
      <section className="panel-card">
        <h2>Divisions</h2>
        <div className="form-stack">
          <label>Active division<select value={divisionId} onChange={e=>setDivisionId(e.target.value)}><option value="">Choose division</option>{divisions.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          {selectedDivision&&<div className="state-card"><strong>{selectedDivision.name}</strong><p>{selectedDivision.disciplineKey.replaceAll('_',' ')} · {selectedDivision.status}</p></div>}
        </div>
        {canManage&&<div className="form-stack setup-subform"><h3>Add division</h3><input placeholder="Division name" value={newDivision.name} onChange={e=>setNewDivision(f=>({...f,name:e.target.value}))}/><input placeholder="Discipline key, e.g. longsword" value={newDivision.disciplineKey} onChange={e=>setNewDivision(f=>({...f,disciplineKey:e.target.value}))}/><button disabled={busy||!newDivision.name||!newDivision.disciplineKey} onClick={addDivision}>Create Division</button></div>}
      </section>

      <section className="panel-card">
        <h2>Pool generator</h2>
        <p>Seed order is reviewed before save. Same team concentration is minimized without destroying seed balance.</p>
        <div className="form-grid">
          <label>Number of pools<input type="number" min="1" max={Math.max(1,selected.length)} value={poolCount} onChange={e=>setPoolCount(Math.max(1,Number(e.target.value)||1))}/></label>
          <label>Advance per pool<input type="number" min="0" value={advancementCount} onChange={e=>setAdvancementCount(Math.max(0,Number(e.target.value)||0))}/></label>
        </div>
        <div className="selector-list">{eligible.map((entry,index)=><label key={entry.id}><input type="checkbox" checked={selected.includes(entry.id)} disabled={!canManage} onChange={e=>setSelected(current=>e.target.checked?[...current,entry.id]:current.filter(id=>id!==entry.id))}/><span><b>#{index+1}</b> {entry.displayName}{entry.teamId?<small> · {entry.teamId}</small>:null}</span></label>)}</div>
        {canManage&&<button className="primary big" disabled={busy||!divisionId||selected.length<2} onClick={generate}>Generate & Save Pools</button>}
      </section>
    </div>

    <section className="section-head"><div><span className="eyebrow">Live standings</span><h2>{selectedDivision?.name??'Division'} Pools</h2></div></section>
    {pools.length===0?<div className="state-card">No pools have been generated for this division yet.</div>:<div className="pool-board">{pools.map(pool=>{
      const standings=standingsFor(pool);
      return <section className="panel-card" key={pool.id}><div className="panel-title-row"><div><h2>{pool.name}</h2><small>Top {pool.advancementCount} advance</small></div>{pool.lockedAt&&<span className="status-pill ok">Locked</span>}</div>
        <div className="table-wrap"><table><thead><tr><th>#</th><th>Competitor</th><th>W</th><th>L</th><th>D</th><th>RD</th><th>SD</th><th>Pts</th></tr></thead><tbody>{standings.map((row,index)=><tr key={row.rosterEntryId}><td>{index+1}</td><td><strong>{row.name}</strong></td><td>{row.wins}</td><td>{row.losses}</td><td>{row.draws}</td><td>{row.roundDifferential}</td><td>{row.scoreDifferential}</td><td><b>{row.standingPoints}</b></td></tr>)}</tbody></table></div>
      </section>;
    })}</div>}
    {message&&<div className="auth-message">{message}</div>}
  </>;
}
