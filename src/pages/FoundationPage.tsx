import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { competitionFormats } from '../lib/competitionFormats';
import {
  archiveClub,
  archiveDivision,
  archiveFoundationFighter,
  claimTemporaryFighter,
  createAffiliation,
  createClub,
  createDivision,
  createNewDivisionVersion,
  endAffiliation,
  findDuplicateFighterCandidates,
  listAffiliations,
  listClubs,
  listDivisions,
  listFoundationFighters,
  listTeams,
  setDivisionStatus,
  updateClub,
  updateDivision
} from '../lib/identityAdmin';
import { assignEventDivision, evaluateDivisionEligibility, listEventDivisions, parseEligibilityRulesJson, removeEventDivision } from '../lib/governance';
import { listRulesets } from '../lib/rulesetAdmin';
import { requestFighterIdentityMerge } from '../lib/fighterIdentity';
import type { AffiliationType, Club, CompetitionDivision, EventDivision, FighterAffiliation, FoundationFighter, RulesetRecord, Team } from '../types';

const today = () => new Date().toISOString().slice(0, 10);

export function FoundationPage() {
  const { event, roster, user, dataMode, reload } = useAppState();
  const [fighters, setFighters] = useState<FoundationFighter[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [divisions, setDivisions] = useState<CompetitionDivision[]>([]);
  const [eventDivisions, setEventDivisions] = useState<EventDivision[]>([]);
  const [rulesets, setRulesets] = useState<RulesetRecord[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [affiliations, setAffiliations] = useState<FighterAffiliation[]>([]);
  const [clubForm, setClubForm] = useState({ name: '', shortName: '', region: '', websiteUrl: '' });
  const [editingClubId, setEditingClubId] = useState('');
  const emptyDivisionForm = () => ({
    name: '', competitionFormatId: competitionFormats[0]?.id || 'longsword', rulesetId: '', teamSize: '',
    minWeightKg: '', maxWeightKg: '', ageMin: '', ageMax: '', minExperienceYears: '', maxExperienceYears: '',
    eligibilityLabel: '', eligibilityRulesText: '[]', eligibilityExplanation: ''
  });
  const [divisionForm, setDivisionForm] = useState(emptyDivisionForm);
  const [editingDivisionId, setEditingDivisionId] = useState('');
  const [eventDivisionForm, setEventDivisionForm] = useState({ divisionId: '', registrationLimit: '', exceptionReason: '' });
  const [eligibilityPreview,setEligibilityPreview]=useState({divisionId:'',birthDate:'',ageYears:'',weightKg:'',experienceYears:'',teamSize:''});
  const [claimForm, setClaimForm] = useState({ rosterEntryId: '', fighterId: '' });
  const [mergeForm, setMergeForm] = useState({ canonical: '', duplicate: '' });
  const [affiliationForm, setAffiliationForm] = useState({ fighterId: '', clubId: '', teamId: '', affiliationType: 'member' as AffiliationType, startsOn: today(), endsOn: '', isPrimary: true });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = Boolean(
    dataMode === 'demo'
    || user?.platformRoles.includes('platform_super_admin')
    || (event && user?.organizationRoles.some(role => role.organizationId === event.organizationId && role.role === 'organization_admin'))
  );

  const temporaryEntries = useMemo(() => roster.filter(entry => entry.entryType === 'ghost_fighter' || entry.entryType === 'guest_fighter'), [roster]);
  const duplicatePairs = useMemo(() => findDuplicateFighterCandidates(fighters), [fighters]);
  const previewDivision=useMemo(()=>divisions.find(row=>row.id===eligibilityPreview.divisionId),[divisions,eligibilityPreview.divisionId]);
  const eligibilityEvaluation=useMemo(()=>{
    if(!previewDivision)return null;
    const numberOrUndefined=(value:string)=>value.trim()===''?undefined:Number(value);
    return evaluateDivisionEligibility(previewDivision,{
      birthDate:eligibilityPreview.birthDate||undefined,
      ageYears:numberOrUndefined(eligibilityPreview.ageYears),
      weightKg:numberOrUndefined(eligibilityPreview.weightKg),
      experienceYears:numberOrUndefined(eligibilityPreview.experienceYears),
      teamSize:numberOrUndefined(eligibilityPreview.teamSize)
    },event?.startsAt);
  },[previewDivision,eligibilityPreview,event?.startsAt]);

  const refresh = async () => {
    if (!event) return;
    const [fighterRows, clubRows, divisionRows, eventDivisionRows, rulesetRows, teamRows, affiliationRows] = await Promise.all([
      listFoundationFighters(event, roster),
      listClubs(event.organizationId),
      listDivisions(event.organizationId),
      listEventDivisions(event.id),
      listRulesets(event.organizationId),
      listTeams(event.organizationId),
      listAffiliations(event.organizationId)
    ]);
    setFighters(fighterRows);
    setClubs(clubRows);
    setDivisions(divisionRows);
    setEventDivisions(eventDivisionRows);
    setRulesets(rulesetRows);
    setTeams(teamRows);
    setAffiliations(affiliationRows);
  };

  useEffect(() => {
    refresh().catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load foundation data.'));
  }, [event?.id, roster.length]);

  if (!event) return <div className="state-card">Choose an event before opening the identity foundation.</div>;
  if (!canManage) return <div className="state-card">Organization administrator access is required for permanent identity and affiliation management.</div>;

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await reload();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The requested change could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const saveClub = () => run(async () => {
    if (editingClubId) {
      await updateClub(event.organizationId, editingClubId, clubForm);
    } else {
      await createClub(event.organizationId, clubForm);
    }
    setClubForm({ name: '', shortName: '', region: '', websiteUrl: '' });
    setEditingClubId('');
  }, editingClubId ? 'Club updated.' : 'Club created.');

  const editClub = (club: Club) => {
    setEditingClubId(club.id);
    setClubForm({ name: club.name, shortName: club.shortName || '', region: club.region || '', websiteUrl: club.websiteUrl || '' });
  };

  const removeClub = (club: Club) => {
    if (!window.confirm('Archive ' + club.name + '? Existing team and history references will be preserved.')) return;
    return run(() => archiveClub(event.organizationId, club.id), 'Club archived without deleting history.');
  };

  const saveDivision = () => run(async () => {
    const rules=parseEligibilityRulesJson(divisionForm.eligibilityRulesText||'[]');
    const input = {
      name: divisionForm.name,
      competitionFormatId: divisionForm.competitionFormatId,
      rulesetId: divisionForm.rulesetId || undefined,
      teamSize: divisionForm.teamSize ? Number(divisionForm.teamSize) : undefined,
      minWeightKg: divisionForm.minWeightKg ? Number(divisionForm.minWeightKg) : undefined,
      maxWeightKg: divisionForm.maxWeightKg ? Number(divisionForm.maxWeightKg) : undefined,
      ageMin: divisionForm.ageMin ? Number(divisionForm.ageMin) : undefined,
      ageMax: divisionForm.ageMax ? Number(divisionForm.ageMax) : undefined,
      minExperienceYears: divisionForm.minExperienceYears ? Number(divisionForm.minExperienceYears) : undefined,
      maxExperienceYears: divisionForm.maxExperienceYears ? Number(divisionForm.maxExperienceYears) : undefined,
      eligibilityLabel: divisionForm.eligibilityLabel || undefined,
      eligibilityRules: rules,
      eligibilityExplanation: divisionForm.eligibilityExplanation || undefined,
      expectedUpdatedAt: editingDivisionId ? divisions.find(row=>row.id===editingDivisionId)?.updatedAt : undefined
    };
    if (editingDivisionId) await updateDivision(event.organizationId, editingDivisionId, input);
    else await createDivision(event.organizationId, input);
    setDivisionForm(emptyDivisionForm());
    setEditingDivisionId('');
  }, editingDivisionId ? 'Division draft updated.' : 'Division created as a draft.');

  const editDivision = (division: CompetitionDivision) => {
    if(division.status!=='draft')return setMessage('Published divisions are immutable. Create a new version to change eligibility.');
    setEditingDivisionId(division.id);
    setDivisionForm({
      name: division.name,
      competitionFormatId: division.competitionFormatId,
      rulesetId: division.rulesetId || '',
      teamSize: division.teamSize ? String(division.teamSize) : '',
      minWeightKg: division.minWeightKg == null ? '' : String(division.minWeightKg),
      maxWeightKg: division.maxWeightKg == null ? '' : String(division.maxWeightKg),
      ageMin: division.ageMin == null ? '' : String(division.ageMin),
      ageMax: division.ageMax == null ? '' : String(division.ageMax),
      minExperienceYears: division.minExperienceYears == null ? '' : String(division.minExperienceYears),
      maxExperienceYears: division.maxExperienceYears == null ? '' : String(division.maxExperienceYears),
      eligibilityLabel: division.eligibilityLabel || '',
      eligibilityRulesText: JSON.stringify(division.eligibilityRules??[],null,2),
      eligibilityExplanation: division.eligibilityExplanation || ''
    });
  };

  const publishDivision = (division: CompetitionDivision) => run(
    () => setDivisionStatus(event.organizationId, division.id, 'published', division.updatedAt),
    'Division version published and locked.'
  );

  const removeDivision = (division: CompetitionDivision) => {
    if (!window.confirm('Retire ' + division.name + ' v' + (division.version??1) + '? Existing event snapshots and historical references remain intact.')) return;
    return run(
      () => archiveDivision(event.organizationId, division.id, division.updatedAt),
      'Division version retired without changing event history.'
    );
  };

  const newDivisionVersion = (division: CompetitionDivision) => run(async()=>{
    const id=await createNewDivisionVersion(event.organizationId,division.id);
    const rows=await listDivisions(event.organizationId);
    setDivisions(rows);
    const next=rows.find(row=>row.id===id);
    if(next)editDivision(next);
  },'New draft division version created and opened for editing.');

  const addEventDivision = () => run(async()=>{
    if(!eventDivisionForm.divisionId)throw new Error('Choose a published division.');
    await assignEventDivision(
      event,eventDivisionForm.divisionId,
      eventDivisionForm.registrationLimit?Number(eventDivisionForm.registrationLimit):undefined,
      eventDivisionForm.exceptionReason||undefined
    );
    setEventDivisionForm({divisionId:'',registrationLimit:'',exceptionReason:''});
  },'Division assigned to this event with an immutable version snapshot.');

  const deleteEventDivision = (row:EventDivision) => run(
    ()=>removeEventDivision(event,row),
    'Event division removed before competition began.'
  );

  const claim = () => {
    const entry = temporaryEntries.find(row => row.id === claimForm.rosterEntryId);
    if (!entry) return setMessage('Choose a temporary fighter first.');
    return run(async () => {
      await claimTemporaryFighter(event, entry.id, claimForm.fighterId || undefined, entry.displayName);
      setClaimForm({ rosterEntryId: '', fighterId: '' });
    }, 'Temporary fighter is now linked to a permanent identity. Historical roster references were preserved.');
  };

  const merge = () => run(async () => {
    const canonical = fighters.find(row => row.id === mergeForm.canonical);
    const duplicate = fighters.find(row => row.id === mergeForm.duplicate);
    if (!canonical || !duplicate) throw new Error('Choose two fighter records to review.');
    await requestFighterIdentityMerge(
      canonical.identityId,
      duplicate.identityId,
      'Duplicate review requested from the organization identity foundation.'
    );
    setMergeForm({ canonical: '', duplicate: '' });
  }, 'Merge review requested. No fighter history has been changed.');

  const addAffiliation = () => {
    const fighter = fighters.find(row => row.id === affiliationForm.fighterId);
    if (!fighter) return setMessage('Choose a fighter.');
    return run(async () => {
      await createAffiliation({
        identityId: fighter.identityId,
        organizationId: event.organizationId,
        clubId: affiliationForm.clubId || undefined,
        teamId: affiliationForm.teamId || undefined,
        affiliationType: affiliationForm.affiliationType,
        startsOn: affiliationForm.startsOn,
        endsOn: affiliationForm.endsOn || undefined,
        isPrimary: affiliationForm.isPrimary,
        sourceEventId: event.id
      });
    }, 'Affiliation history updated.');
  };

  const closeAffiliation = (row: FighterAffiliation) => run(
    () => endAffiliation(event.organizationId, row.id),
    'Affiliation ended and retained in fighter history.'
  );

  const archiveFighter = (fighter: FoundationFighter) => {
    if (!window.confirm('Archive ' + fighter.name + '? Historical roster, match, and discipline records will be preserved.')) return;
    return run(() => archiveFoundationFighter(event, roster, fighter.id), 'Fighter archived without deleting historical records.');
  };

  return <>
    <section className="section-head">
      <div>
        <span className="eyebrow">Permanent foundation</span>
        <h1>Identity, Clubs & Divisions</h1>
        <p>Manage durable fighter identities and history separately from event-day roster entries. Claims and merges preserve the roster IDs already referenced by matches and results.</p>
      </div>
    </section>

    <div className="admin-grid">
      <section className="panel-card">
        <h2>Claim temporary fighter</h2>
        <p>Turn a ghost or guest entry into a permanent fighter, or attach it to an existing fighter without rewriting match history.</p>
        <div className="form-stack">
          <label>Temporary roster entry
            <select value={claimForm.rosterEntryId} onChange={e => setClaimForm(form => ({ ...form, rosterEntryId: e.target.value }))}>
              <option value="">Choose fighter</option>
              {temporaryEntries.map(entry => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
            </select>
          </label>
          <label>Permanent fighter
            <select value={claimForm.fighterId} onChange={e => setClaimForm(form => ({ ...form, fighterId: e.target.value }))}>
              <option value="">Create a new permanent fighter</option>
              {fighters.map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}</option>)}
            </select>
          </label>
          <button className="primary big" disabled={busy || !claimForm.rosterEntryId} onClick={claim}>Claim Fighter</button>
        </div>
        {temporaryEntries.length === 0 && <div className="state-card">No temporary fighters are waiting to be claimed.</div>}
      </section>

      <section className="panel-card">
        <h2>Review duplicate fighters</h2>
        <p>Possible duplicates are suggestions only. Request a governed identity merge so completed roster entries, results and match history are never silently rewritten.</p>
        {duplicatePairs.length > 0 && <div className="state-card">{duplicatePairs.length} exact-name duplicate pair{duplicatePairs.length === 1 ? '' : 's'} detected.</div>}
        <div className="form-stack">
          <label>Keep
            <select value={mergeForm.canonical} onChange={e => setMergeForm(form => ({ ...form, canonical: e.target.value }))}>
              <option value="">Canonical fighter</option>
              {fighters.map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}</option>)}
            </select>
          </label>
          <label>Merge away
            <select value={mergeForm.duplicate} onChange={e => setMergeForm(form => ({ ...form, duplicate: e.target.value }))}>
              <option value="">Duplicate fighter</option>
              {fighters.filter(fighter => fighter.id !== mergeForm.canonical).map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}</option>)}
            </select>
          </label>
          <button disabled={busy || !mergeForm.canonical || !mergeForm.duplicate} onClick={merge}>Request Merge Review</button>
        </div>
        <div className="membership-list">
          {fighters.slice(0, 12).map(fighter => <article key={fighter.id}><div className="grow"><strong>{fighter.name}</strong><small>{fighter.userId ? 'Claimed account' : 'Unclaimed identity'}{fighter.teamId ? ' · team linked' : ''}</small></div><button disabled={busy} onClick={() => archiveFighter(fighter)}>Archive</button></article>)}
        </div>
      </section>

      <section className="panel-card">
        <h2>Clubs</h2>
        <p>Clubs are durable organization-level homes. Teams can sit under clubs while fighter affiliation history remains time-based.</p>
        <div className="form-stack">
          <input placeholder="Club name" value={clubForm.name} onChange={e => setClubForm(form => ({ ...form, name: e.target.value }))}/>
          <input placeholder="Short name" value={clubForm.shortName} onChange={e => setClubForm(form => ({ ...form, shortName: e.target.value }))}/>
          <input placeholder="Region" value={clubForm.region} onChange={e => setClubForm(form => ({ ...form, region: e.target.value }))}/>
          <input placeholder="Website URL, optional" value={clubForm.websiteUrl} onChange={e => setClubForm(form => ({ ...form, websiteUrl: e.target.value }))}/>
          <button disabled={busy || !clubForm.name.trim()} onClick={saveClub}>{editingClubId ? 'Save Club' : 'Add Club'}</button>
          {editingClubId && <button disabled={busy} onClick={() => { setEditingClubId(''); setClubForm({ name: '', shortName: '', region: '', websiteUrl: '' }); }}>Cancel Edit</button>}
        </div>
        <div className="membership-list">
          {clubs.length === 0 ? <div className="state-card">No clubs created yet.</div> : clubs.map(club => <article key={club.id}><div className="grow"><strong>{club.name}</strong><small>{[club.shortName, club.region].filter(Boolean).join(' · ') || 'No extra details'}</small></div><div className="header-actions"><button disabled={busy} onClick={() => editClub(club)}>Edit</button><button disabled={busy} onClick={() => removeClub(club)}>Archive</button></div></article>)}
        </div>
      </section>

      <section className="panel-card">
        <h2>Competition divisions</h2>
        <p>Division definitions are versioned. Published eligibility can never be edited in place.</p>
        <div className="form-stack">
          <input placeholder="Division name" value={divisionForm.name} onChange={e=>setDivisionForm(form=>({...form,name:e.target.value}))}/>
          <label>Competition format<select value={divisionForm.competitionFormatId} onChange={e=>setDivisionForm(form=>({...form,competitionFormatId:e.target.value}))}>{competitionFormats.map(format=><option key={format.id} value={format.id}>{format.name} · {format.supportLevel.replaceAll('_',' ')}</option>)}</select></label>
          <label>Division ruleset<select value={divisionForm.rulesetId} onChange={e=>setDivisionForm(form=>({...form,rulesetId:e.target.value}))}><option value="">No division-specific override</option>{rulesets.filter(row=>row.status==='published').map(row=><option key={row.id} value={row.id}>{row.shortName} {row.version}</option>)}</select></label>
          <div className="form-grid-two"><input type="number" min="1" placeholder="Team size" value={divisionForm.teamSize} onChange={e=>setDivisionForm(form=>({...form,teamSize:e.target.value}))}/><input placeholder="Eligibility label" value={divisionForm.eligibilityLabel} onChange={e=>setDivisionForm(form=>({...form,eligibilityLabel:e.target.value}))}/></div>
          <div className="form-grid-two"><input type="number" min="0" placeholder="Minimum age" value={divisionForm.ageMin} onChange={e=>setDivisionForm(form=>({...form,ageMin:e.target.value}))}/><input type="number" min="0" placeholder="Maximum age" value={divisionForm.ageMax} onChange={e=>setDivisionForm(form=>({...form,ageMax:e.target.value}))}/></div>
          <div className="form-grid-two"><input type="number" min="0" step="0.1" placeholder="Min weight kg" value={divisionForm.minWeightKg} onChange={e=>setDivisionForm(form=>({...form,minWeightKg:e.target.value}))}/><input type="number" min="0" step="0.1" placeholder="Max weight kg" value={divisionForm.maxWeightKg} onChange={e=>setDivisionForm(form=>({...form,maxWeightKg:e.target.value}))}/></div>
          <div className="form-grid-two"><input type="number" min="0" step="0.1" placeholder="Min experience years" value={divisionForm.minExperienceYears} onChange={e=>setDivisionForm(form=>({...form,minExperienceYears:e.target.value}))}/><input type="number" min="0" step="0.1" placeholder="Max experience years" value={divisionForm.maxExperienceYears} onChange={e=>setDivisionForm(form=>({...form,maxExperienceYears:e.target.value}))}/></div>
          <label>Additional eligibility rules<textarea rows={7} value={divisionForm.eligibilityRulesText} onChange={e=>setDivisionForm(form=>({...form,eligibilityRulesText:e.target.value}))}/></label>
          <small>JSON array examples: age/weight/experience/team-size ranges, declarations, or manual custom checks. Missing facts become “needs review”, never an automatic pass.</small>
          <label>Human explanation<textarea rows={4} value={divisionForm.eligibilityExplanation} onChange={e=>setDivisionForm(form=>({...form,eligibilityExplanation:e.target.value}))}/></label>
          <button disabled={busy||!divisionForm.name.trim()} onClick={saveDivision}>{editingDivisionId?'Save Draft Division':'Create Draft Division'}</button>
          {editingDivisionId&&<button disabled={busy} onClick={()=>{setEditingDivisionId('');setDivisionForm(emptyDivisionForm());}}>Cancel Edit</button>}
        </div>
        <div className="membership-list">
          {divisions.length===0?<div className="state-card">No formal divisions created yet.</div>:divisions.map(division=><article key={division.id}><div className="grow"><strong>{division.name} · v{division.version??1}</strong><small>{division.competitionFormatId.replaceAll('_',' ')} · {division.status}{division.eligibilityLabel?' · '+division.eligibilityLabel:''}</small></div><div className="header-actions">{division.status==='draft'&&<><button disabled={busy} onClick={()=>editDivision(division)}>Edit</button><button disabled={busy} onClick={()=>publishDivision(division)}>Publish</button></>}{division.status==='published'&&<><button disabled={busy} onClick={()=>newDivisionVersion(division)}>New Version</button><button disabled={busy} onClick={()=>removeDivision(division)}>Retire</button></>}{division.status==='retired'&&<button disabled={busy} onClick={()=>newDivisionVersion(division)}>New Version</button>}</div></article>)}
        </div>

        <h3>Divisions on this event</h3>
        <div className="form-stack setup-subform">
          <label>Published division<select value={eventDivisionForm.divisionId} onChange={e=>setEventDivisionForm(form=>({...form,divisionId:e.target.value}))}><option value="">Choose division</option>{divisions.filter(row=>row.status==='published'&&!eventDivisions.some(ed=>ed.divisionId===row.id)).map(row=><option key={row.id} value={row.id}>{row.name} · v{row.version??1}</option>)}</select></label>
          <input type="number" min="1" placeholder="Registration limit, optional" value={eventDivisionForm.registrationLimit} onChange={e=>setEventDivisionForm(form=>({...form,registrationLimit:e.target.value}))}/>
          <textarea placeholder="Exception reason only if this division ruleset is outside its effective window" value={eventDivisionForm.exceptionReason} onChange={e=>setEventDivisionForm(form=>({...form,exceptionReason:e.target.value}))}/>
          <button disabled={busy||!eventDivisionForm.divisionId||!['draft','published'].includes(event.status)} onClick={addEventDivision}>Assign to Event</button>
          {!event.rulesetSnapshotId&&eventDivisionForm.divisionId&&!divisions.find(row=>row.id===eventDivisionForm.divisionId)?.rulesetId&&<small>Lock an event ruleset first, or choose a division with its own published ruleset.</small>}
        </div>
        <div className="membership-list">{eventDivisions.length===0?<div className="state-card">No divisions assigned to this event.</div>:eventDivisions.map(row=>{const division=divisions.find(item=>item.id===row.divisionId);const snap=row.divisionSnapshot;return <article key={row.id}><div className="grow"><strong>{String(snap?.name??division?.name??'Division')} · v{String(snap?.version??division?.version??1)}</strong><small>Registration {row.isRegistrationOpen?'open':'closed'}{row.registrationLimit?' · limit '+row.registrationLimit:''} · snapshot preserved</small></div>{['draft','published'].includes(event.status)&&<button disabled={busy} onClick={()=>deleteEventDivision(row)}>Remove</button>}</article>;})}</div>
      </section>

      <section className="panel-card">
        <h2>Eligibility preview</h2>
        <p>Explain a division decision before using it. These facts are evaluated in the browser for preview only and are not saved.</p>
        <div className="form-stack">
          <label>Division<select value={eligibilityPreview.divisionId} onChange={e=>setEligibilityPreview(form=>({...form,divisionId:e.target.value}))}><option value="">Choose division</option>{divisions.filter(row=>row.status!=='retired').map(row=><option key={row.id} value={row.id}>{row.name} · v{row.version??1}</option>)}</select></label>
          <div className="form-grid-two"><label>Birth date<input type="date" value={eligibilityPreview.birthDate} onChange={e=>setEligibilityPreview(form=>({...form,birthDate:e.target.value}))}/></label><label>Age, if known directly<input type="number" min="0" value={eligibilityPreview.ageYears} onChange={e=>setEligibilityPreview(form=>({...form,ageYears:e.target.value}))}/></label></div>
          <div className="form-grid-two"><label>Weight kg<input type="number" min="0" step="0.1" value={eligibilityPreview.weightKg} onChange={e=>setEligibilityPreview(form=>({...form,weightKg:e.target.value}))}/></label><label>Experience years<input type="number" min="0" step="0.1" value={eligibilityPreview.experienceYears} onChange={e=>setEligibilityPreview(form=>({...form,experienceYears:e.target.value}))}/></label></div>
          <label>Team size<input type="number" min="1" value={eligibilityPreview.teamSize} onChange={e=>setEligibilityPreview(form=>({...form,teamSize:e.target.value}))}/></label>
        </div>
        {eligibilityEvaluation&&<div className="state-card" aria-live="polite"><strong>{eligibilityEvaluation.status.replace('_',' ').toUpperCase()}</strong>{eligibilityEvaluation.reasons.length>0&&<ul>{eligibilityEvaluation.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}{eligibilityEvaluation.passed.length>0&&<><small>Confirmed</small><ul>{eligibilityEvaluation.passed.map(reason=><li key={reason}>{reason}</li>)}</ul></>}</div>}
        <small>Missing facts never count as a pass. Declaration and custom rules remain needs-review until an organizer has the required evidence.</small>
      </section>

      <section className="panel-card">
        <h2>Affiliation history</h2>
        <p>Record when a fighter represented a club or team, including mercenary and guest periods. Past affiliations are retained instead of overwriting the fighter record.</p>
        <div className="form-stack">
          <label>Fighter
            <select value={affiliationForm.fighterId} onChange={e => setAffiliationForm(form => ({ ...form, fighterId: e.target.value }))}>
              <option value="">Choose fighter</option>
              {fighters.map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}</option>)}
            </select>
          </label>
          <label>Type
            <select value={affiliationForm.affiliationType} onChange={e => setAffiliationForm(form => ({ ...form, affiliationType: e.target.value as AffiliationType }))}>
              <option value="member">Member</option>
              <option value="mercenary">Mercenary</option>
              <option value="guest">Guest</option>
              <option value="independent">Independent</option>
            </select>
          </label>
          <label>Club
            <select value={affiliationForm.clubId} onChange={e => setAffiliationForm(form => ({ ...form, clubId: e.target.value }))}>
              <option value="">No club</option>
              {clubs.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}
            </select>
          </label>
          <label>Team
            <select value={affiliationForm.teamId} onChange={e => setAffiliationForm(form => ({ ...form, teamId: e.target.value }))}>
              <option value="">No team</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label>Start date<input type="date" value={affiliationForm.startsOn} onChange={e => setAffiliationForm(form => ({ ...form, startsOn: e.target.value }))}/></label>
          <label>End date<input type="date" value={affiliationForm.endsOn} onChange={e => setAffiliationForm(form => ({ ...form, endsOn: e.target.value }))}/></label>
          <label><input type="checkbox" checked={affiliationForm.isPrimary} onChange={e => setAffiliationForm(form => ({ ...form, isPrimary: e.target.checked }))}/> Primary affiliation</label>
          <button disabled={busy || !affiliationForm.fighterId} onClick={addAffiliation}>Add Affiliation</button>
        </div>
        <div className="membership-list">
          {affiliations.length === 0 ? <div className="state-card">No affiliation history recorded yet.</div> : affiliations.slice(0, 12).map(row => {
            const fighter = fighters.find(item => item.identityId === row.identityId);
            const club = clubs.find(item => item.id === row.clubId);
            const team = teams.find(item => item.id === row.teamId);
            return <article key={row.id}><div className="grow"><strong>{fighter?.name || 'Fighter'}</strong><small>{row.affiliationType} · {club?.name || team?.name || 'Independent'} · {row.startsOn}{row.endsOn ? ' to ' + row.endsOn : ' to present'}</small></div>{!row.endsOn && <button disabled={busy} onClick={() => closeAffiliation(row)}>End</button>}</article>;
          })}
        </div>
      </section>
    </div>

    {message && <div className="auth-message">{message}</div>}
  </>;
}
