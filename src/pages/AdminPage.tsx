import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { checkCompliance } from '../lib/compliance';
import { computePoolQualificationState, generateDoubleElimination, generateRoundRobin, generateRoundRobinPools, generateSingleElimination } from '../lib/bracket';
import { addGhostFighter, listEventDivisionOptions, listEventTeamOptions, saveBracketPlan, type AdminOption } from '../lib/adminActions';
import { inviteEventMember, listEventMemberships, listPendingEventInvitations, removeEventMembership, revokeEventInvitation, type EventInvitationView, type EventMembershipView } from '../lib/memberAdmin';
import { competitionFormatById, competitionFormats } from '../lib/competitionFormats';
import type { Bracket, EventRole } from '../types';

const assignableRoles: Array<{value: EventRole; label: string}> = [
  { value:'tournament_director', label:'Tournament Director' },
  { value:'event_organizer', label:'Event Organizer' },
  { value:'field_marshal', label:'Field Marshal' },
  { value:'assistant_marshal', label:'Assistant Marshal' },
  { value:'scorekeeper', label:'Scorekeeper' },
  { value:'registration_staff', label:'Registration Staff' },
  { value:'armor_inspector', label:'Armor Inspector' },
  { value:'medical_staff', label:'Medical Staff' },
  { value:'team_captain', label:'Team Captain' },
  { value:'fighter', label:'Fighter' }
];

export function AdminPage() {
  const { event, roster, fightCards, matches, reload } = useAppState();
  const [temporaryForm,setTemporaryForm]=useState({name:'',countryCode:'',teamId:'',divisionId:''});
  const [teamDirectory,setTeamDirectory]=useState<AdminOption[]>([]);
  const [divisionDirectory,setDivisionDirectory]=useState<AdminOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [bracketFormat, setBracketFormat] = useState<Bracket['format']>('single_elimination');
  const [competitionFormatId, setCompetitionFormatId] = useState('longsword');
  const [poolSize, setPoolSize] = useState(4);
  const [fightCardId, setFightCardId] = useState('');
  const [qualifiersPerPool, setQualifiersPerPool] = useState(2);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [memberships,setMemberships]=useState<EventMembershipView[]>([]);
  const [pendingInvitations,setPendingInvitations]=useState<EventInvitationView[]>([]);
  const [memberForm, setMemberForm] = useState<{email:string; displayName:string; role:EventRole; teamId:string}>({ email:'', displayName:'', role:'field_marshal', teamId:'' });
  const eligible = useMemo(() => roster.filter(r => checkCompliance(r).eligible), [roster]);
  const teamOptions=useMemo(()=>teamDirectory.length?teamDirectory.map(team=>({id:team.id,label:team.name})):[...new Set(roster.map(entry=>entry.teamId).filter((id):id is string=>Boolean(id)))].map(id=>({id,label:roster.filter(entry=>entry.teamId===id).slice(0,2).map(entry=>entry.displayName).join(', ')||'Team '+id.slice(0,8)})),[roster,teamDirectory]);
  const poolStructures = useMemo(() => [...new Set(matches.filter(match => match.stage === 'pool' && match.bracketId).map(match => match.bracketId!))].map(bracketId => ({
    bracketId,
    first: matches.find(match => match.bracketId === bracketId && match.stage === 'pool')!
  })), [matches]);

  const loadMembers=async()=>{
    if(!event)return;
    try{
      const [members,pending,teams,divisions]=await Promise.all([
        listEventMemberships(event.id),
        listPendingEventInvitations(event.id),
        listEventTeamOptions(event),
        listEventDivisionOptions(event)
      ]);
      setMemberships(members);
      setPendingInvitations(pending);
      setTeamDirectory(teams);
      setDivisionDirectory(divisions);
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to load event administration data.');}
  };
  useEffect(()=>{loadMembers();},[event?.id]);
  if (!event) return null;

  const addGhost=async()=>{
    if(!temporaryForm.name.trim())return;
    setBusy(true);setMessage('');
    try{
      await addGhostFighter(
        event,
        temporaryForm.name.trim(),
        temporaryForm.teamId||undefined,
        temporaryForm.countryCode.trim()||undefined,
        temporaryForm.divisionId||undefined
      );
      setTemporaryForm({name:'',countryCode:'',teamId:'',divisionId:''});
      await reload();
      setMessage('Temporary fighter created. Complete required clearances before competition.');
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to create temporary fighter.');}
    finally{setBusy(false);}
  };
  const generate = async () => {
    const chosen = eligible.filter(r => selected.includes(r.id));
    if (chosen.length < 2) return setMessage('Choose at least two cleared competitors.');
    setBusy(true); setMessage('');
    try {
      const bracketId = crypto.randomUUID();
      const preset = competitionFormatById(competitionFormatId);
      const entries = chosen.map((entry,index) => ({ entry, seed: index + 1 }));
      const common = { organizationId: event.organizationId, seasonId: event.seasonId, eventId: event.id, fightCardId: fightCardId || undefined, bracketId, category: preset.name, matchType: preset.matchType, entries, scoringConfig: preset.scoringConfig };
      const plan = bracketFormat === 'round_robin'
        ? generateRoundRobin(common)
        : bracketFormat === 'pools_to_bracket'
          ? generateRoundRobinPools({ ...common, targetPoolSize: poolSize })
          : bracketFormat === 'double_elimination'
            ? generateDoubleElimination(common)
            : generateSingleElimination(common);
      const poolMetadata = 'pools' in plan ? { pools: plan.pools, targetPoolSize: poolSize } : {};
      await saveBracketPlan(event, plan, {
        id: bracketId,
        name: preset.name + ' ' + bracketFormat.replaceAll('_',' ') + ' ' + new Date().toLocaleDateString(),
        fightCardId: fightCardId || undefined,
        category: preset.name,
        format: bracketFormat,
        metadata: poolMetadata
      });
      await reload();
      setMessage('Competition structure created with ' + plan.matches.length + ' matches.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to create competition structure.'); }
    finally { setBusy(false); }
  };
  const advancePools = async (sourceBracketId: string) => {
    const qualification = computePoolQualificationState(matches, roster, sourceBracketId, qualifiersPerPool);
    if (!qualification.ready) return setMessage('All pool matches must be finalized before qualifiers can advance.');
    if (qualification.qualifiers.length < 2) return setMessage('Not enough qualifiers are available to build the playoff bracket.');
    const source = matches.find(match => match.bracketId === sourceBracketId && match.stage === 'pool');
    if (!source) return setMessage('Pool competition could not be found.');
    setBusy(true); setMessage('');
    try {
      const bracketId = crypto.randomUUID();
      const playoff = generateSingleElimination({
        organizationId: event.organizationId,
        seasonId: event.seasonId,
        eventId: event.id,
        fightCardId: fightCardId || source.fightCardId,
        bracketId,
        category: source.category,
        matchType: source.matchType,
        entries: qualification.qualifiers,
        scoringConfig: source.scoringConfig
      });
      await saveBracketPlan(event, playoff, {
        id: bracketId,
        name: source.category + ' Playoff',
        fightCardId: fightCardId || source.fightCardId,
        category: source.category,
        format: 'single_elimination',
        metadata: {
          sourcePoolBracketId: sourceBracketId,
          qualifiersPerPool,
          pools: qualification.pools.map(pool => ({ name: pool.name, qualifiers: pool.standings.slice(0, qualifiersPerPool).map(row => row.rosterEntryId) }))
        }
      });
      await reload();
      setMessage('Pool qualifiers seeded into a ' + playoff.matches.length + '-match playoff bracket.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to advance pool qualifiers.');
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    if (!memberForm.email.trim()) return;
    if (memberForm.role === 'team_captain' && !memberForm.teamId) return setMessage('Choose a team for the captain.');
    setBusy(true); setMessage('');
    try {
      const result = await inviteEventMember({ eventId:event.id, email:memberForm.email.trim(), displayName:memberForm.displayName.trim() || undefined, role:memberForm.role, teamId:memberForm.role === 'team_captain' ? memberForm.teamId : undefined });
      await loadMembers();
      setMemberForm({ email:'', displayName:'', role:'field_marshal', teamId:'' });
      setMessage(result.assigned?'Existing account found and event access assigned.':'Invitation email sent. Access will attach automatically when the account is created.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to assign event access.'); }
    finally { setBusy(false); }
  };
  const removeMember = async (id: string) => {
    setBusy(true); setMessage('');
    try { await removeEventMembership(id); await loadMembers(); setMessage('Event role removed.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to remove event role.'); }
    finally { setBusy(false); }
  };
  const revokeInvitation=async(id:string)=>{
    setBusy(true);setMessage('');
    try{await revokeEventInvitation(id);await loadMembers();setMessage('Pending invitation revoked.');}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to revoke invitation.');}
    finally{setBusy(false);}
  };

  return <>
    <section className="section-head"><div><span className="eyebrow">Event setup</span><h1>Organizer Tools</h1><p>Administrative actions are kept separate from live field controls.</p></div></section>
    <div className="admin-grid">
      <section className="panel-card"><h2>Add temporary fighter</h2><p>Create a mergeable fighter identity and event roster entry without changing anyone's permanent club or home team.</p><div className="form-stack">
        <label>Display name<input value={temporaryForm.name} onChange={e=>setTemporaryForm(form=>({...form,name:e.target.value}))} placeholder="Required"/></label>
        <label>Country code<input value={temporaryForm.countryCode} maxLength={2} onChange={e=>setTemporaryForm(form=>({...form,countryCode:e.target.value.toUpperCase()}))} placeholder="CA"/></label>
        <label>Tournament team<select value={temporaryForm.teamId} onChange={e=>setTemporaryForm(form=>({...form,teamId:e.target.value}))}><option value="">Independent</option>{teamOptions.map(team=><option key={team.id} value={team.id}>{team.label}</option>)}</select></label>
        <label>Division<select value={temporaryForm.divisionId} onChange={e=>setTemporaryForm(form=>({...form,divisionId:e.target.value}))}><option value="">Not assigned yet</option>{divisionDirectory.map(division=><option key={division.id} value={division.id}>{division.name}</option>)}</select></label>
        <button className="primary big" disabled={busy||!temporaryForm.name.trim()} onClick={addGhost}>Create Temporary Fighter</button>
      </div></section>
      <section className="panel-card"><h2>Build competition structure</h2><p>Choose the division and competition format. Only cleared competitors can be placed into live competition.</p><div className="form-stack"><label>Division<select value={competitionFormatId} onChange={e=>setCompetitionFormatId(e.target.value)}>{competitionFormats.map(format=><option key={format.id} value={format.id}>{format.name}</option>)}</select></label><label>Format<select value={bracketFormat} onChange={e=>setBracketFormat(e.target.value as Bracket['format'])}><option value="single_elimination">Single elimination</option><option value="double_elimination">Double elimination</option><option value="round_robin">Round robin</option><option value="pools_to_bracket">Pools</option></select></label><label>Field / list<select value={fightCardId} onChange={e=>setFightCardId(e.target.value)}><option value="">Unassigned</option>{[...fightCards].filter(card=>card.status!=='archived').sort((a,b)=>a.sortOrder-b.sortOrder).map(card=><option key={card.id} value={card.id}>{card.name}</option>)}</select></label>{bracketFormat==='pools_to_bracket'&&<label>Target pool size<input type="number" min="3" max="12" value={poolSize} onChange={e=>setPoolSize(Math.max(3,Number(e.target.value)||4))}/></label>}</div><div className="selector-list">{eligible.map(entry => <label key={entry.id}><input type="checkbox" checked={selected.includes(entry.id)} onChange={e => setSelected(current => e.target.checked ? [...current, entry.id] : current.filter(id => id !== entry.id))}/><span>{entry.displayName}</span></label>)}</div><button className="primary big" disabled={busy || selected.length < 2} onClick={generate}>Generate Competition</button></section>
      <section className="panel-card"><h2>Advance pool qualifiers</h2><p>Completed pools can seed directly into an elimination playoff. Rankings use wins, standing points, score differential and points scored as deterministic tie-breakers.</p><div className="form-stack"><label>Qualifiers per pool<input type="number" min="1" max="8" value={qualifiersPerPool} onChange={e=>setQualifiersPerPool(Math.max(1,Number(e.target.value)||2))}/></label><label>Playoff field<select value={fightCardId} onChange={e=>setFightCardId(e.target.value)}><option value="">Keep pool field</option>{[...fightCards].filter(card=>card.status!=='archived').sort((a,b)=>a.sortOrder-b.sortOrder).map(card=><option key={card.id} value={card.id}>{card.name}</option>)}</select></label></div><div className="pool-advance-list">{poolStructures.length===0?<div className="state-card">No pool competitions have been created yet.</div>:poolStructures.map(structure=>{const state=computePoolQualificationState(matches,roster,structure.bracketId,qualifiersPerPool);return <article key={structure.bracketId}><div className="grow"><b>{structure.first.category}</b><small>{state.pools.length} pool{state.pools.length===1?'':'s'} · {state.ready?state.qualifiers.length+' qualifiers ready':state.incompleteMatchIds.length+' pool matches remaining'}</small></div><button className={state.ready?'primary':''} disabled={busy||!state.ready} onClick={()=>advancePools(structure.bracketId)}>{state.ready?'Create Playoff':'Pools Incomplete'}</button></article>;})}</div></section>
      <section className="panel-card"><h2>Invite event member</h2><p>Invitations are handled server-side. Service credentials never enter the browser.</p><div className="form-stack"><label>Email<input type="email" value={memberForm.email} onChange={e=>setMemberForm(f=>({...f,email:e.target.value}))}/></label><label>Display name<input value={memberForm.displayName} onChange={e=>setMemberForm(f=>({...f,displayName:e.target.value}))}/></label><label>Role<select value={memberForm.role} onChange={e=>setMemberForm(f=>({...f,role:e.target.value as EventRole,teamId:e.target.value === 'team_captain' ? f.teamId : ''}))}>{assignableRoles.map(role=><option key={role.value} value={role.value}>{role.label}</option>)}</select></label>{memberForm.role === 'team_captain' && <label>Captain team<select value={memberForm.teamId} onChange={e=>setMemberForm(f=>({...f,teamId:e.target.value}))}><option value="">Choose team</option>{teamOptions.map(team=><option key={team.id} value={team.id}>{team.label}</option>)}</select></label>}<button className="primary big" disabled={busy || !memberForm.email} onClick={addMember}>Invite / Assign Access</button></div></section>
      <section className="panel-card"><h2>Event access</h2><p>Removing an event role never deletes the account, fighter identity, or sporting history.</p><div className="membership-list">
        {memberships.length===0?<div className="state-card">No assigned event roles are visible yet.</div>:memberships.map(member=><article key={member.id}><div><strong>{member.displayName}</strong><small>{member.role.replaceAll('_',' ')}{member.teamId?' · team '+member.teamId.slice(0,8):''}</small></div><button disabled={busy} onClick={()=>removeMember(member.id)}>Remove</button></article>)}
        {pendingInvitations.map(invite=><article key={invite.id}><div><strong>{invite.email}</strong><small>Pending · {invite.role.replaceAll('_',' ')} · expires {new Date(invite.expiresAt).toLocaleDateString()}</small></div><button disabled={busy} onClick={()=>revokeInvitation(invite.id)}>Revoke</button></article>)}
      </div></section>
    </div>
    {message && <div className="auth-message">{message}</div>}
  </>;
}
