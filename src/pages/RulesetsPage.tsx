import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { competitionFormats } from '../lib/competitionFormats';
import {
  addRulesetSource,
  deleteRulesetSource,
  knownRulesetSources,
  listEventPolicyExceptions,
  listEventRulesetSnapshots,
  listRulesetSources
} from '../lib/governance';
import {
  activateEventRuleset,
  createRuleset,
  defaultRulesetSettings,
  listRulesets,
  resolveRulesetSettings,
  setRulesetStatus,
  updateDraftRuleset
} from '../lib/rulesetAdmin';
import type {
  EventPolicyException,
  EventRulesetSnapshot,
  RulesetRecord,
  RulesetSettings,
  RulesetSource,
  RulesetSourceKind,
  RulesetStatus
} from '../types';

const cloneSettings=(settings:RulesetSettings):RulesetSettings=>structuredClone(settings);
const json=(value:Record<string,unknown>|undefined)=>JSON.stringify(value??{},null,2);
const today=()=>new Date().toISOString().slice(0,10);

export function RulesetsPage(){
  const {event,user,dataMode,reload}=useAppState();
  const [rulesets,setRulesets]=useState<RulesetRecord[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [draft,setDraft]=useState<RulesetRecord|null>(null);
  const [sources,setSources]=useState<RulesetSource[]>([]);
  const [snapshots,setSnapshots]=useState<EventRulesetSnapshot[]>([]);
  const [exceptions,setExceptions]=useState<EventPolicyException[]>([]);
  const [createForm,setCreateForm]=useState({name:'',shortName:'',version:'1.0',parentRulesetId:'',description:''});
  const [sourceForm,setSourceForm]=useState({
    preset:'bi-current',label:'',sourceUrl:'',versionLabel:'',sourceKind:'official' as RulesetSourceKind,
    effectiveFrom:'',effectiveTo:'',accessedOn:today(),notes:''
  });
  const [policyText,setPolicyText]=useState({eligibility:'{}',scoring:'{}',tournament:'{}',ranking:'{}'});
  const [eventExceptionReason,setEventExceptionReason]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  const canManage=Boolean(
    dataMode==='demo'
    ||user?.platformRoles.includes('platform_super_admin')
    ||(event&&user?.organizationRoles.some(role=>role.organizationId===event.organizationId&&role.role==='organization_admin'))
  );
  const eventRulesLocked=Boolean(event&&['live','completed','archived'].includes(event.status));
  const currentSnapshot=useMemo(
    ()=>snapshots.find(row=>row.id===event?.rulesetSnapshotId)||snapshots[0],
    [snapshots,event?.rulesetSnapshotId]
  );

  const refresh=async()=>{
    if(!event)return;
    const [rows,snapshotRows,exceptionRows]=await Promise.all([
      listRulesets(event.organizationId),listEventRulesetSnapshots(event.id),listEventPolicyExceptions(event.id)
    ]);
    setRulesets(rows);setSnapshots(snapshotRows);setExceptions(exceptionRows);
    setSelectedId(current=>current&&rows.some(row=>row.id===current)?current:(rows[0]?.id||''));
  };

  useEffect(()=>{refresh().catch(error=>setMessage(error instanceof Error?error.message:'Unable to load rulesets.'));},[event?.id]);

  useEffect(()=>{
    const selected=rulesets.find(row=>row.id===selectedId);
    if(!selected){setDraft(null);setSources([]);return;}
    setDraft({...selected,settings:cloneSettings(resolveRulesetSettings(rulesets,selected.id))});
    setPolicyText({
      eligibility:json(selected.eligibilityPolicy),scoring:json(selected.scoringPolicy),
      tournament:json(selected.tournamentPolicy),ranking:json(selected.rankingPolicy)
    });
    listRulesetSources(selected.id).then(setSources).catch(error=>setMessage(error instanceof Error?error.message:'Unable to load ruleset sources.'));
  },[selectedId,rulesets]);

  const effective=useMemo(()=>draft?resolveRulesetSettings(
    rulesets.map(row=>row.id===draft.id?{...draft,overrides:draft.settings}:row),draft.id
  ):null,[draft,rulesets]);

  if(!event)return <div className="state-card">Choose an event before managing rulesets.</div>;
  if(!canManage)return <div className="state-card">Organization administrator access is required to manage rulesets.</div>;

  const run=async(work:()=>Promise<unknown>,success:string)=>{
    setBusy(true);setMessage('');
    try{await work();await reload();await refresh();setMessage(success);}
    catch(error){setMessage(error instanceof Error?error.message:'The ruleset change could not be completed.');}
    finally{setBusy(false);}
  };

  const create=()=>run(async()=>{
    if(!createForm.name.trim()||!createForm.shortName.trim()||!createForm.version.trim())throw new Error('Name, short name, and version are required.');
    const id=await createRuleset(event,{
      name:createForm.name.trim(),shortName:createForm.shortName.trim(),version:createForm.version.trim(),
      description:createForm.description.trim()||undefined,status:'draft',
      parentRulesetId:createForm.parentRulesetId||undefined,
      settings:createForm.parentRulesetId?cloneSettings(resolveRulesetSettings(rulesets,createForm.parentRulesetId)):cloneSettings(defaultRulesetSettings),
      overrides:createForm.parentRulesetId?{}:cloneSettings(defaultRulesetSettings),
      eligibilityPolicy:{},scoringPolicy:{},tournamentPolicy:{},rankingPolicy:{}
    });
    setCreateForm({name:'',shortName:'',version:'1.0',parentRulesetId:'',description:''});
    setSelectedId(id);
  },'Draft ruleset created.');

  const patchSettings=(patch:(current:RulesetSettings)=>RulesetSettings)=>{
    setDraft(current=>current?{...current,settings:patch(cloneSettings(current.settings)),overrides:undefined}:current);
  };

  const parsedPolicies=()=>{
    try{
      return {
        eligibilityPolicy:JSON.parse(policyText.eligibility) as Record<string,unknown>,
        scoringPolicy:JSON.parse(policyText.scoring) as Record<string,unknown>,
        tournamentPolicy:JSON.parse(policyText.tournament) as Record<string,unknown>,
        rankingPolicy:JSON.parse(policyText.ranking) as Record<string,unknown>
      };
    }catch{throw new Error('Each policy domain must contain valid JSON.');}
  };

  const saveDraft=()=>{
    if(!draft)return;
    return run(()=>updateDraftRuleset(event,{...draft,...parsedPolicies(),overrides:draft.settings}),'Draft ruleset saved.');
  };

  const transition=(record:RulesetRecord,status:RulesetStatus)=>run(
    ()=>setRulesetStatus(event,record,status),
    status==='review'?'Ruleset entered review and is now read-only until returned to draft.':
    status==='published'?'Ruleset published and immutable for historical stability.':
    status==='draft'?'Ruleset returned to draft for edits.':'Ruleset retired without changing event history.'
  );

  const activate=(record:RulesetRecord|null)=>run(
    async()=>{await activateEventRuleset(event,record?.id||null,eventExceptionReason||undefined);},
    record?`${record.name} ${record.version} was snapshotted onto this event.`:'Event ruleset cleared.'
  );

  const useSourcePreset=(id:string)=>{
    const preset=knownRulesetSources.find(row=>row.id===id);
    setSourceForm(current=>preset?{
      ...current,preset:id,label:preset.label,sourceUrl:preset.sourceUrl,
      versionLabel:preset.versionLabel,sourceKind:preset.sourceKind,notes:preset.note
    }:{...current,preset:id});
  };

  const addSource=()=>{
    if(!draft)return;
    return run(async()=>{
      await addRulesetSource(draft.id,{
        label:sourceForm.label,sourceUrl:sourceForm.sourceUrl||undefined,versionLabel:sourceForm.versionLabel||undefined,
        effectiveFrom:sourceForm.effectiveFrom?new Date(sourceForm.effectiveFrom).toISOString():undefined,
        effectiveTo:sourceForm.effectiveTo?new Date(sourceForm.effectiveTo).toISOString():undefined,
        sourceKind:sourceForm.sourceKind,accessedOn:sourceForm.accessedOn||undefined,notes:sourceForm.notes||undefined
      });
      setSources(await listRulesetSources(draft.id));
    },'Rules source attached to this draft.');
  };

  const removeSource=(id:string)=>run(async()=>{
    await deleteRulesetSource(id);
    if(draft)setSources(await listRulesetSources(draft.id));
  },'Draft source removed.');

  return <>
    <section className="section-head"><div><span className="eyebrow">Versioned policy engine</span><h1>Rulesets</h1><p>Source, review, publish, inherit, and snapshot the exact policy version used by an event. Eligibility, scoring, tournament, and ranking policy stay separate.</p></div></section>

    <div className="admin-grid">
      <section className="panel-card"><h2>Create ruleset version</h2><div className="form-stack">
        <input placeholder="Ruleset name" value={createForm.name} onChange={e=>setCreateForm(form=>({...form,name:e.target.value}))}/>
        <input placeholder="Short name" value={createForm.shortName} onChange={e=>setCreateForm(form=>({...form,shortName:e.target.value}))}/>
        <input placeholder="Version" value={createForm.version} onChange={e=>setCreateForm(form=>({...form,version:e.target.value}))}/>
        <label>Inherit from<select value={createForm.parentRulesetId} onChange={e=>setCreateForm(form=>({...form,parentRulesetId:e.target.value}))}><option value="">BuhurtOS verified-format defaults</option>{rulesets.filter(row=>row.status==='published').map(row=><option key={row.id} value={row.id}>{row.shortName} {row.version}</option>)}</select></label>
        <textarea placeholder="Description" value={createForm.description} onChange={e=>setCreateForm(form=>({...form,description:e.target.value}))}/>
        <button className="primary big" disabled={busy||!createForm.name.trim()||!createForm.shortName.trim()} onClick={create}>Create Draft</button>
      </div></section>

      <section className="panel-card"><h2>Ruleset library</h2><div className="membership-list">
        {rulesets.length===0?<div className="state-card">No rulesets yet.</div>:rulesets.map(record=><article key={record.id}><div><strong>{record.name} · {record.version}</strong><small>{record.status}{record.parentRulesetId?' · inherited':''}{event.rulesetId===record.id?' · selected on event':''}</small></div><button className={selectedId===record.id?'primary':''} onClick={()=>setSelectedId(record.id)}>Open</button></article>)}
      </div>
      {!eventRulesLocked&&<button disabled={busy||!event.rulesetId} onClick={()=>activate(null)}>Clear Event Ruleset</button>}
      {eventRulesLocked&&<div className="state-card">Event rules are locked because this event is {event.status}.</div>}
      </section>

      {draft&&<section className="panel-card"><h2>{draft.name} {draft.version}</h2>
        <p>{draft.status==='draft'?'Editable draft. Send it to review when source evidence and policy are ready.':draft.status==='review'?'Review is read-only. Return to draft for corrections or publish this exact version.':'Published and retired versions are immutable.'}</p>
        <div className="form-stack">
          <label>Name<input disabled={draft.status!=='draft'} value={draft.name} onChange={e=>setDraft(row=>row?({...row,name:e.target.value}):row)}/></label>
          <label>Short name<input disabled={draft.status!=='draft'} value={draft.shortName} onChange={e=>setDraft(row=>row?({...row,shortName:e.target.value}):row)}/></label>
          <label>Version<input disabled={draft.status!=='draft'} value={draft.version} onChange={e=>setDraft(row=>row?({...row,version:e.target.value}):row)}/></label>
          <label>Effective from<input disabled={draft.status!=='draft'} type="datetime-local" value={draft.effectiveFrom?.slice(0,16)||''} onChange={e=>setDraft(row=>row?({...row,effectiveFrom:e.target.value?new Date(e.target.value).toISOString():undefined}):row)}/></label>
          <label>Effective to<input disabled={draft.status!=='draft'} type="datetime-local" value={draft.effectiveTo?.slice(0,16)||''} onChange={e=>setDraft(row=>row?({...row,effectiveTo:e.target.value?new Date(e.target.value).toISOString():undefined}):row)}/></label>
          <label>Description<textarea disabled={draft.status!=='draft'} value={draft.description||''} onChange={e=>setDraft(row=>row?({...row,description:e.target.value}):row)}/></label>
        </div>
        <h3>Competition formats</h3><div className="selector-list">{competitionFormats.map(format=>{
          const checked=draft.settings.enabledFormats.includes(format.id);
          return <label key={format.id} title={format.description}><input type="checkbox" disabled={draft.status!=='draft'} checked={checked} onChange={e=>patchSettings(settings=>({...settings,enabledFormats:e.target.checked?[...new Set([...settings.enabledFormats,format.id])]:settings.enabledFormats.filter(id=>id!==format.id)}))}/><span>{format.name} · {format.supportLevel.replaceAll('_',' ')}</span></label>;
        })}</div>
      </section>}

      {draft&&<section className="panel-card"><h2>Source provenance</h2>
        <p>Publication requires at least one source. Internal drafting evidence stays private and is not copied into public event snapshots.</p>
        <div className="membership-list">{sources.length===0?<div className="state-card">No sources attached yet.</div>:sources.map(source=><article key={source.id}><div className="grow"><strong>{source.label}</strong><small>{source.sourceKind} · {source.versionLabel||'version not recorded'}{source.sourceUrl?' · '+source.sourceUrl:''}</small></div>{draft.status==='draft'&&<button disabled={busy} onClick={()=>removeSource(source.id)}>Remove</button>}</article>)}</div>
        {draft.status==='draft'&&<div className="form-stack setup-subform">
          <label>Known source<select value={sourceForm.preset} onChange={e=>useSourcePreset(e.target.value)}><option value="">Custom source</option>{knownRulesetSources.map(source=><option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
          <input placeholder="Source label" value={sourceForm.label} onChange={e=>setSourceForm(form=>({...form,label:e.target.value}))}/>
          <input placeholder="https:// official source" value={sourceForm.sourceUrl} onChange={e=>setSourceForm(form=>({...form,sourceUrl:e.target.value}))}/>
          <input placeholder="Document / version label" value={sourceForm.versionLabel} onChange={e=>setSourceForm(form=>({...form,versionLabel:e.target.value}))}/>
          <label>Source kind<select value={sourceForm.sourceKind} onChange={e=>setSourceForm(form=>({...form,sourceKind:e.target.value as RulesetSourceKind}))}><option value="official">Official governing source</option><option value="organization">Organization adoption/amendment</option><option value="event">Event-specific source</option><option value="historical">Historical source</option><option value="internal">Internal drafting evidence</option></select></label>
          <label>Accessed on<input type="date" value={sourceForm.accessedOn} onChange={e=>setSourceForm(form=>({...form,accessedOn:e.target.value}))}/></label>
          <label>Source effective from<input type="datetime-local" value={sourceForm.effectiveFrom} onChange={e=>setSourceForm(form=>({...form,effectiveFrom:e.target.value}))}/></label>
          <label>Source effective to<input type="datetime-local" value={sourceForm.effectiveTo} onChange={e=>setSourceForm(form=>({...form,effectiveTo:e.target.value}))}/></label>
          <textarea placeholder="Notes about what was adopted" value={sourceForm.notes} onChange={e=>setSourceForm(form=>({...form,notes:e.target.value}))}/>
          <button disabled={busy||!sourceForm.label.trim()} onClick={addSource}>Attach Source</button>
        </div>}
      </section>}

      {draft&&<section className="panel-card"><h2>Policy domains</h2><p>These are version-local overrides. Parent policy is deep-merged into the immutable event snapshot.</p>
        <div className="form-stack">
          <label>Eligibility policy<textarea rows={7} disabled={draft.status!=='draft'} value={policyText.eligibility} onChange={e=>setPolicyText(v=>({...v,eligibility:e.target.value}))}/></label>
          <label>Scoring policy<textarea rows={7} disabled={draft.status!=='draft'} value={policyText.scoring} onChange={e=>setPolicyText(v=>({...v,scoring:e.target.value}))}/></label>
          <label>Tournament policy<textarea rows={7} disabled={draft.status!=='draft'} value={policyText.tournament} onChange={e=>setPolicyText(v=>({...v,tournament:e.target.value}))}/></label>
          <label>Ranking policy<textarea rows={7} disabled={draft.status!=='draft'} value={policyText.ranking} onChange={e=>setPolicyText(v=>({...v,ranking:e.target.value}))}/></label>
        </div>
      </section>}

      {draft&&<section className="panel-card"><h2>Safety, discipline & lifecycle</h2><div className="form-stack">
        {([
          ['requireCheckIn','Require check in'],['requireArmorClearance','Require armor clearance'],
          ['requireMedicalClearance','Require medical clearance'],['requireWaiver','Require waiver'],
          ['requireWeighIn','Require weigh in']
        ] as const).map(([key,label])=><label className="checkbox-line" key={key}><input type="checkbox" disabled={draft.status!=='draft'} checked={draft.settings.compliance[key]} onChange={e=>patchSettings(settings=>({...settings,compliance:{...settings.compliance,[key]:e.target.checked}}))}/><span>{label}</span></label>)}
        <label>Yellow cards before suspension<input type="number" min="1" disabled={draft.status!=='draft'} value={draft.settings.discipline.yellowCardsBeforeSuspension} onChange={e=>patchSettings(settings=>({...settings,discipline:{...settings.discipline,yellowCardsBeforeSuspension:Math.max(1,Number(e.target.value)||1)}}))}/></label>
        <label>Red card suspension matches<input type="number" min="1" disabled={draft.status!=='draft'} value={draft.settings.discipline.redCardSuspensionMatches} onChange={e=>patchSettings(settings=>({...settings,discipline:{...settings.discipline,redCardSuspensionMatches:Math.max(1,Number(e.target.value)||1)}}))}/></label>
        <label className="checkbox-line"><input type="checkbox" disabled={draft.status!=='draft'} checked={draft.settings.bracket.antiFratricide} onChange={e=>patchSettings(settings=>({...settings,bracket:{...settings.bracket,antiFratricide:e.target.checked}}))}/><span>Anti-fratricide seeding</span></label>
      </div>
      <div className="header-actions">
        {draft.status==='draft'&&<><button className="primary" disabled={busy} onClick={saveDraft}>Save Draft</button><button disabled={busy} onClick={()=>transition(draft,'review')}>Send to Review</button></>}
        {draft.status==='review'&&<><button disabled={busy} onClick={()=>transition(draft,'draft')}>Return to Draft</button><button className="primary" disabled={busy||sources.length===0} onClick={()=>transition(draft,'published')}>Publish Exact Version</button></>}
        {draft.status==='published'&&!eventRulesLocked&&<button className={event.rulesetId===draft.id?'primary':''} disabled={busy} onClick={()=>activate(draft)}>{event.rulesetId===draft.id?'Snapshot Again':'Use for Event'}</button>}
        {draft.status==='published'&&<button disabled={busy||event.rulesetId===draft.id} onClick={()=>transition(draft,'retired')}>Retire Version</button>}
      </div>
      {effective&&<div className="state-card">Effective configuration: {effective.enabledFormats.length} formats · armor {effective.compliance.requireArmorClearance?'required':'optional'} · medical {effective.compliance.requireMedicalClearance?'required':'optional'} · anti-fratricide {effective.bracket.antiFratricide?'on':'off'}.</div>}
      </section>}

      <section className="panel-card"><h2>Event rules snapshot</h2>
        {currentSnapshot?<><div className="state-card"><strong>{currentSnapshot.rulesetName} · {currentSnapshot.rulesetVersion}</strong><br/>Locked {new Date(currentSnapshot.lockedAt).toLocaleString()} · {currentSnapshot.sourceSnapshot.length} public source record{currentSnapshot.sourceSnapshot.length===1?'':'s'} · inheritance depth {currentSnapshot.rulesetChain.length}.</div><details><summary>Resolved policy snapshot</summary><pre>{JSON.stringify({eligibility:currentSnapshot.eligibilityPolicy,scoring:currentSnapshot.scoringPolicy,tournament:currentSnapshot.tournamentPolicy,ranking:currentSnapshot.rankingPolicy},null,2)}</pre></details></>:<div className="state-card">No immutable rules snapshot has been locked to this event yet.</div>}
        {!eventRulesLocked&&<label className="form-stack">Exception reason for out-of-window rules, only when needed<textarea value={eventExceptionReason} onChange={e=>setEventExceptionReason(e.target.value)} placeholder="Explain why this event is authorized to use a ruleset outside its effective window."/></label>}
        <h3>Approved exceptions</h3><div className="membership-list">{exceptions.length===0?<div className="state-card">No event policy exceptions recorded.</div>:exceptions.map(row=><article key={row.id}><div><strong>{row.policyDomain} · {row.ruleKey}</strong><small>{row.reason} · {row.status}</small></div></article>)}</div>
      </section>
    </div>

    {message&&<div className="auth-message" role="status">{message}</div>}
  </>;
}
