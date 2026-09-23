import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import type { AffiliationType, TeamType } from '../types';
import {
  assignAccessGrant, createCategoryAdmin, createClubAdmin, createCustomRole, createDisciplineAdmin,
  createDivisionAdmin, createFighterAdmin, createFighterAffiliation, createRulesetAdmin, createSeasonAdmin,
  createTeamAdmin, loadFoundationSnapshot, mergeAdmin, renameFoundationRecord, reviewClaimAdmin,
  revokeAccessGrant, setCustomRolePermissions, setFoundationActive, setRulesetAdminStatus, updateOrganization, updateSeasonAdmin,
  type FoundationSnapshot
} from '../lib/foundationAdmin';
import { hasPermission } from '../lib/permissions';

const teamTypes:TeamType[]=['permanent','season','a_team','b_team','womens','youth','competition','tournament','temporary','mercenary','mixed'];
const affiliationTypes:AffiliationType[]=['home_club','permanent_team','season_team','tournament_team','temporary_team','mercenary','historical_representation'];

function formatName(value:string){return value.replaceAll('_',' ');}

export function FoundationAdminPage(){
  const {event,user}=useAppState();
  const [data,setData]=useState<FoundationSnapshot|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [ruleJson,setRuleJson]=useState('{}');
  const [rolePermissionKeys,setRolePermissionKeys]=useState<string[]>([]);
  const [forms,setForms]=useState({
    season:{name:'',startsAt:'',endsAt:''},
    ruleset:{name:'',shortName:'',version:'1.0',parentRulesetId:''},
    discipline:{code:'',name:'',competitionKind:'team'},
    division:{disciplineId:'',code:'',name:'',minimumFighters:'',maximumFighters:''},
    category:{divisionId:'',code:'',name:'',teamSize:''},
    club:{name:'',shortName:'',countryCode:'',provinceState:'',city:''},
    team:{name:'',clubId:'',divisionId:'',teamType:'permanent',countryCode:''},
    fighter:{name:'',nickname:'',countryCode:'',teamId:'',isTemporary:false,publicProfile:true},
    affiliation:{fighterId:'',clubId:'',teamId:'',seasonId:'',affiliationType:'home_club',startsOn:'',endsOn:'',isPrimary:true},
    role:{roleKey:'',name:'',scopeType:'organization'},
    grant:{userId:'',roleId:'',expiresAt:''},
    merge:{entityType:'fighter',sourceId:'',targetId:'',reason:''}
  });
  const organizationId=event?.organizationId;
  const canManage=Boolean(event&&hasPermission(user,'organization.manage',event.id,event.organizationId));
  const canRules=Boolean(event&&hasPermission(user,'ruleset.manage',event.id,event.organizationId));
  const canDivisions=Boolean(event&&hasPermission(user,'division.manage',event.id,event.organizationId));
  const canClubs=Boolean(event&&hasPermission(user,'club.manage',event.id,event.organizationId));
  const canTeams=Boolean(event&&hasPermission(user,'team.manage',event.id,event.organizationId));
  const canFighters=Boolean(event&&hasPermission(user,'fighter.manage',event.id,event.organizationId));
  const canClaims=Boolean(event&&hasPermission(user,'fighter.claim.review',event.id,event.organizationId));
  const canMerge=Boolean(event&&hasPermission(user,'duplicate.merge',event.id,event.organizationId));
  const canRoles=Boolean(event&&hasPermission(user,'roles.manage',event.id,event.organizationId));

  const load=useCallback(async()=>{
    if(!organizationId)return;
    try{setData(await loadFoundationSnapshot(organizationId));setMessage('');}
    catch(error){setMessage(error instanceof Error?error.message:'Unable to load foundation administration.');}
  },[organizationId]);

  useEffect(()=>{load();},[load]);

  const run=async(action:()=>Promise<void>,success:string)=>{
    setBusy(true);setMessage('');
    try{await action();await load();setMessage(success);}
    catch(error){setMessage(error instanceof Error?error.message:'Administrative action failed.');}
    finally{setBusy(false);}
  };

  const rename=async(table:'disciplines'|'divisions'|'competition_categories'|'clubs'|'teams'|'fighters'|'role_definitions',id:string,current:string)=>{
    const name=window.prompt('New name',current);
    if(name===null||name.trim()===current.trim())return;
    await run(()=>renameFoundationRecord(table,id,name),'Name updated.');
  };

  const active=async(table:'disciplines'|'divisions'|'competition_categories'|'clubs'|'teams'|'fighters'|'role_definitions',id:string,value:boolean)=>{
    await run(()=>setFoundationActive(table,id,value),value?'Record enabled.':'Record disabled.');
  };

  if(!event)return <div className="state-card"><h2>Select an event first</h2><p>Foundation administration is scoped through the event's organization.</p></div>;
  if(!canManage)return <div className="state-card"><h2>Organization administrator access required</h2><p>This area changes permanent identities and configuration, so event-only roles cannot use it.</p></div>;
  if(!data)return <div className="state-card">{message||'Loading permanent foundation…'}</div>;

  const org=data.organization;
  const updateForm=(section:keyof typeof forms,key:string,value:unknown)=>setForms(current=>({...current,[section]:{...(current[section] as any),[key]:value}}));
  const pendingClaims=data.claims.filter(claim=>claim.status==='pending');
  const customRoles=data.roles.filter(role=>!role.isSystem);
  const organizationRoles=data.roles.filter(role=>role.scopeType==='organization');

  return <>
    <section className="section-head"><div><span className="eyebrow">Permanent platform foundation</span><h1>Organization Administration</h1><p>Permanent identities, historical relationships and sporting configuration live here. Event-day controls remain separate.</p></div></section>
    {message&&<div className="auth-message">{message}</div>}

    <div className="admin-grid foundation-grid">
      <details className="panel-card" open>
        <summary><strong>Organization</strong><small>Brand, public status and region</small></summary>
        <div className="form-stack detail-body">
          <label>Name<input value={org.name} onChange={e=>setData(current=>current?{...current,organization:{...current.organization,name:e.target.value}}:current)}/></label>
          <label>Short name<input value={org.shortName} onChange={e=>setData(current=>current?{...current,organization:{...current.organization,shortName:e.target.value}}:current)}/></label>
          <label>Region<input value={org.region} onChange={e=>setData(current=>current?{...current,organization:{...current.organization,region:e.target.value}}:current)}/></label>
          <label>Country code<input maxLength={2} value={org.countryCode??''} onChange={e=>setData(current=>current?{...current,organization:{...current.organization,countryCode:e.target.value.toUpperCase()}}:current)}/></label>
          <label>Website<input type="url" value={org.websiteUrl??''} onChange={e=>setData(current=>current?{...current,organization:{...current.organization,websiteUrl:e.target.value}}:current)}/></label>
          <label>Description<textarea rows={3} value={org.description??''} onChange={e=>setData(current=>current?{...current,organization:{...current.organization,description:e.target.value}}:current)}/></label>
          <label>Status<select value={org.status} onChange={e=>setData(current=>current?{...current,organization:{...current.organization,status:e.target.value as 'active'|'inactive'}}:current)}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          <button className="primary" disabled={busy} onClick={()=>run(()=>updateOrganization(org),'Organization updated.')}>Save Organization</button>
        </div>
      </details>

      <details className="panel-card">
        <summary><strong>Seasons</strong><small>{data.seasons.length} records</small></summary>
        <div className="detail-body">
          <div className="form-stack setup-subform">
            <input placeholder="Season name" value={forms.season.name} onChange={e=>updateForm('season','name',e.target.value)}/>
            <label>Starts<input type="date" value={forms.season.startsAt} onChange={e=>updateForm('season','startsAt',e.target.value)}/></label>
            <label>Ends<input type="date" value={forms.season.endsAt} onChange={e=>updateForm('season','endsAt',e.target.value)}/></label>
            <button disabled={busy||!forms.season.name||!forms.season.startsAt||!forms.season.endsAt} onClick={()=>run(()=>createSeasonAdmin(org.id,{name:forms.season.name,startsAt:forms.season.startsAt,endsAt:forms.season.endsAt}),'Season created.')}>Create Season</button>
          </div>
          <div className="membership-list">{data.seasons.map(season=><article key={season.id}><div><strong>{season.name}</strong><small>{season.status} · {season.startsAt.slice(0,10)} to {season.endsAt.slice(0,10)}</small></div><div className="row-actions"><button disabled={busy} onClick={()=>{const name=window.prompt('Season name',season.name);if(name)run(()=>updateSeasonAdmin(season.id,{name}),'Season renamed.');}}>Edit</button>{season.status!=='active'&&<button disabled={busy} onClick={()=>run(()=>updateSeasonAdmin(season.id,{status:'active'}),'Season activated.')}>Activate</button>}{season.status!=='archived'&&<button disabled={busy} onClick={()=>run(()=>updateSeasonAdmin(season.id,{status:'archived'}),'Season archived and historical rules preserved.')}>Archive</button>}</div></article>)}</div>
        </div>
      </details>

      {canRules&&<details className="panel-card">
        <summary><strong>Rulesets</strong><small>Versioned and immutable after publication</small></summary>
        <div className="detail-body">
          <div className="form-stack setup-subform">
            <input placeholder="Ruleset name" value={forms.ruleset.name} onChange={e=>updateForm('ruleset','name',e.target.value)}/>
            <input placeholder="Short name" value={forms.ruleset.shortName} onChange={e=>updateForm('ruleset','shortName',e.target.value)}/>
            <input placeholder="Version" value={forms.ruleset.version} onChange={e=>updateForm('ruleset','version',e.target.value)}/>
            <label>Parent<select value={forms.ruleset.parentRulesetId} onChange={e=>updateForm('ruleset','parentRulesetId',e.target.value)}><option value="">No parent</option>{data.rulesets.filter(rule=>rule.status!=='retired').map(rule=><option value={rule.id} key={rule.id}>{rule.name} {rule.version}</option>)}</select></label>
            <label>Settings override JSON<textarea rows={7} value={ruleJson} onChange={e=>setRuleJson(e.target.value)}/></label>
            <button disabled={busy||!forms.ruleset.name||!forms.ruleset.shortName||!forms.ruleset.version} onClick={()=>run(async()=>{let settings:Record<string,unknown>;try{settings=JSON.parse(ruleJson);}catch{throw new Error('Ruleset settings must be valid JSON.');}await createRulesetAdmin(org.id,{...forms.ruleset,parentRulesetId:forms.ruleset.parentRulesetId||undefined,settings});},'Draft ruleset created.')}>Create Draft Ruleset</button>
          </div>
          <div className="membership-list">{data.rulesets.map(rule=><article key={rule.id}><div><strong>{rule.name} · {rule.version}</strong><small>{rule.status}{rule.parentRulesetId?' · inherits parent':''}</small></div><div className="row-actions">{rule.status==='draft'&&<button disabled={busy} onClick={()=>run(()=>setRulesetAdminStatus(rule.id,'published'),'Ruleset published and locked.')}>Publish</button>}{rule.status==='published'&&<button disabled={busy} onClick={()=>run(()=>setRulesetAdminStatus(rule.id,'retired'),'Ruleset retired. Historical assignments remain intact.')}>Retire</button>}</div></article>)}</div>
        </div>
      </details>}

      {canDivisions&&<details className="panel-card">
        <summary><strong>Competition Configuration</strong><small>Disciplines, divisions and categories</small></summary>
        <div className="detail-body config-sections">
          <div className="setup-subform form-stack"><h3>Discipline</h3><input placeholder="Code" value={forms.discipline.code} onChange={e=>updateForm('discipline','code',e.target.value)}/><input placeholder="Name" value={forms.discipline.name} onChange={e=>updateForm('discipline','name',e.target.value)}/><select value={forms.discipline.competitionKind} onChange={e=>updateForm('discipline','competitionKind',e.target.value)}><option value="team">Team</option><option value="individual">Individual</option><option value="hybrid">Hybrid</option></select><button disabled={busy||!forms.discipline.code||!forms.discipline.name} onClick={()=>run(()=>createDisciplineAdmin(org.id,{code:forms.discipline.code,name:forms.discipline.name,competitionKind:forms.discipline.competitionKind as any}),'Discipline created.')}>Add Discipline</button></div>
          <div className="membership-list">{data.disciplines.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{item.code} · {item.competitionKind}</small></div><div className="row-actions"><button onClick={()=>rename('disciplines',item.id,item.name)}>Edit</button><button onClick={()=>active('disciplines',item.id,!item.isActive)}>{item.isActive?'Disable':'Enable'}</button></div></article>)}</div>
          <div className="setup-subform form-stack"><h3>Division</h3><select value={forms.division.disciplineId} onChange={e=>updateForm('division','disciplineId',e.target.value)}><option value="">Choose discipline</option>{data.disciplines.filter(item=>item.isActive).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><input placeholder="Code" value={forms.division.code} onChange={e=>updateForm('division','code',e.target.value)}/><input placeholder="Name" value={forms.division.name} onChange={e=>updateForm('division','name',e.target.value)}/><div className="inline-form"><input type="number" min="1" placeholder="Min fighters" value={forms.division.minimumFighters} onChange={e=>updateForm('division','minimumFighters',e.target.value)}/><input type="number" min="1" placeholder="Max fighters" value={forms.division.maximumFighters} onChange={e=>updateForm('division','maximumFighters',e.target.value)}/></div><button disabled={busy||!forms.division.disciplineId||!forms.division.code||!forms.division.name} onClick={()=>run(()=>createDivisionAdmin(org.id,{disciplineId:forms.division.disciplineId,code:forms.division.code,name:forms.division.name,minimumFighters:forms.division.minimumFighters?Number(forms.division.minimumFighters):undefined,maximumFighters:forms.division.maximumFighters?Number(forms.division.maximumFighters):undefined}),'Division created.')}>Add Division</button></div>
          <div className="membership-list">{data.divisions.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{item.code}</small></div><div className="row-actions"><button onClick={()=>rename('divisions',item.id,item.name)}>Edit</button><button onClick={()=>active('divisions',item.id,!item.isActive)}>{item.isActive?'Disable':'Enable'}</button></div></article>)}</div>
          <div className="setup-subform form-stack"><h3>Competition Category</h3><select value={forms.category.divisionId} onChange={e=>updateForm('category','divisionId',e.target.value)}><option value="">Choose division</option>{data.divisions.filter(item=>item.isActive).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><input placeholder="Code" value={forms.category.code} onChange={e=>updateForm('category','code',e.target.value)}/><input placeholder="Name" value={forms.category.name} onChange={e=>updateForm('category','name',e.target.value)}/><input type="number" min="1" placeholder="Team size if applicable" value={forms.category.teamSize} onChange={e=>updateForm('category','teamSize',e.target.value)}/><button disabled={busy||!forms.category.divisionId||!forms.category.code||!forms.category.name} onClick={()=>run(()=>createCategoryAdmin(org.id,{divisionId:forms.category.divisionId,code:forms.category.code,name:forms.category.name,teamSize:forms.category.teamSize?Number(forms.category.teamSize):undefined}),'Category created.')}>Add Category</button></div>
          <div className="membership-list">{data.categories.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{item.code}{item.teamSize?' · '+item.teamSize+' fighters':''}</small></div><div className="row-actions"><button onClick={()=>rename('competition_categories',item.id,item.name)}>Edit</button><button onClick={()=>active('competition_categories',item.id,!item.isActive)}>{item.isActive?'Disable':'Enable'}</button></div></article>)}</div>
        </div>
      </details>}

      {canClubs&&<details className="panel-card">
        <summary><strong>Clubs</strong><small>{data.clubs.length} permanent clubs</small></summary>
        <div className="detail-body"><div className="form-stack setup-subform"><input placeholder="Club name" value={forms.club.name} onChange={e=>updateForm('club','name',e.target.value)}/><input placeholder="Short name" value={forms.club.shortName} onChange={e=>updateForm('club','shortName',e.target.value)}/><div className="inline-form"><input placeholder="Country" maxLength={2} value={forms.club.countryCode} onChange={e=>updateForm('club','countryCode',e.target.value.toUpperCase())}/><input placeholder="Province/state" value={forms.club.provinceState} onChange={e=>updateForm('club','provinceState',e.target.value)}/><input placeholder="City" value={forms.club.city} onChange={e=>updateForm('club','city',e.target.value)}/></div><button disabled={busy||!forms.club.name} onClick={()=>run(()=>createClubAdmin(org.id,forms.club),'Club created.')}>Add Club</button></div><div className="membership-list">{data.clubs.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{[item.city,item.provinceState,item.countryCode].filter(Boolean).join(', ')||'Location not set'}</small></div><div className="row-actions"><button onClick={()=>rename('clubs',item.id,item.name)}>Edit</button><button onClick={()=>active('clubs',item.id,!item.isActive)}>{item.isActive?'Disable':'Enable'}</button></div></article>)}</div></div>
      </details>}

      {canTeams&&<details className="panel-card">
        <summary><strong>Teams</strong><small>Permanent, seasonal and tournament teams</small></summary>
        <div className="detail-body"><div className="form-stack setup-subform"><input placeholder="Team name" value={forms.team.name} onChange={e=>updateForm('team','name',e.target.value)}/><select value={forms.team.clubId} onChange={e=>updateForm('team','clubId',e.target.value)}><option value="">No club</option>{data.clubs.filter(item=>item.isActive).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={forms.team.divisionId} onChange={e=>updateForm('team','divisionId',e.target.value)}><option value="">No default division</option>{data.divisions.filter(item=>item.isActive).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={forms.team.teamType} onChange={e=>updateForm('team','teamType',e.target.value)}>{teamTypes.map(type=><option value={type} key={type}>{formatName(type)}</option>)}</select><input maxLength={2} placeholder="Country" value={forms.team.countryCode} onChange={e=>updateForm('team','countryCode',e.target.value.toUpperCase())}/><button disabled={busy||!forms.team.name} onClick={()=>run(()=>createTeamAdmin(org.id,{...forms.team,teamType:forms.team.teamType as TeamType,clubId:forms.team.clubId||undefined,divisionId:forms.team.divisionId||undefined}),'Team created.')}>Add Team</button></div><div className="membership-list">{data.teams.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{formatName(item.teamType)}{item.countryCode?' · '+item.countryCode:''}</small></div><div className="row-actions"><button onClick={()=>rename('teams',item.id,item.name)}>Edit</button><button onClick={()=>active('teams',item.id,!item.isActive)}>{item.isActive?'Disable':'Enable'}</button></div></article>)}</div></div>
      </details>}

      {canFighters&&<details className="panel-card">
        <summary><strong>Fighters and Affiliations</strong><small>Identity is permanent; affiliations are dated</small></summary>
        <div className="detail-body">
          <div className="form-stack setup-subform"><h3>Create fighter</h3><input placeholder="Display name" value={forms.fighter.name} onChange={e=>updateForm('fighter','name',e.target.value)}/><input placeholder="Nickname" value={forms.fighter.nickname} onChange={e=>updateForm('fighter','nickname',e.target.value)}/><input maxLength={2} placeholder="Country" value={forms.fighter.countryCode} onChange={e=>updateForm('fighter','countryCode',e.target.value.toUpperCase())}/><select value={forms.fighter.teamId} onChange={e=>updateForm('fighter','teamId',e.target.value)}><option value="">No legacy default team</option>{data.teams.filter(item=>item.isActive).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><button disabled={busy||!forms.fighter.name} onClick={()=>run(()=>createFighterAdmin(org.id,{...forms.fighter,teamId:forms.fighter.teamId||undefined}),'Fighter created.')}>Add Fighter</button></div>
          <div className="membership-list">{data.fighters.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{item.isTemporary?'temporary identity':'permanent identity'}{item.nickname?' · '+item.nickname:''}</small></div><div className="row-actions"><button onClick={()=>rename('fighters',item.id,item.name)}>Edit</button><button onClick={()=>active('fighters',item.id,!item.isActive)}>{item.isActive?'Disable':'Enable'}</button></div></article>)}</div>
          <div className="form-stack setup-subform"><h3>Add dated affiliation</h3><select value={forms.affiliation.fighterId} onChange={e=>updateForm('affiliation','fighterId',e.target.value)}><option value="">Choose fighter</option>{data.fighters.filter(item=>item.isActive).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={forms.affiliation.affiliationType} onChange={e=>updateForm('affiliation','affiliationType',e.target.value)}>{affiliationTypes.map(type=><option value={type} key={type}>{formatName(type)}</option>)}</select><select value={forms.affiliation.clubId} onChange={e=>updateForm('affiliation','clubId',e.target.value)}><option value="">No club</option>{data.clubs.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={forms.affiliation.teamId} onChange={e=>updateForm('affiliation','teamId',e.target.value)}><option value="">No team</option>{data.teams.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={forms.affiliation.seasonId} onChange={e=>updateForm('affiliation','seasonId',e.target.value)}><option value="">No season scope</option>{data.seasons.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><div className="inline-form"><label>Starts<input type="date" value={forms.affiliation.startsOn} onChange={e=>updateForm('affiliation','startsOn',e.target.value)}/></label><label>Ends<input type="date" value={forms.affiliation.endsOn} onChange={e=>updateForm('affiliation','endsOn',e.target.value)}/></label></div><button disabled={busy||!forms.affiliation.fighterId||(!forms.affiliation.clubId&&!forms.affiliation.teamId)} onClick={()=>run(()=>createFighterAffiliation({fighterId:forms.affiliation.fighterId,organizationId:org.id,clubId:forms.affiliation.clubId||undefined,teamId:forms.affiliation.teamId||undefined,seasonId:forms.affiliation.seasonId||undefined,affiliationType:forms.affiliation.affiliationType as AffiliationType,startsOn:forms.affiliation.startsOn||undefined,endsOn:forms.affiliation.endsOn||undefined,isPrimary:forms.affiliation.isPrimary}),'Affiliation added without overwriting history.')}>Add Affiliation</button></div>
        </div>
      </details>}

      {canClaims&&<details className="panel-card">
        <summary><strong>Profile Claims</strong><small>{pendingClaims.length} pending</small></summary>
        <div className="detail-body membership-list">{pendingClaims.length===0?<div className="state-card">No fighter profile claims need review.</div>:pendingClaims.map(claim=><article key={claim.id}><div><strong>{claim.fighterName}</strong><small>{claim.statement||'No claim note provided'} · user {claim.userId.slice(0,8)}</small></div><div className="row-actions"><button className="primary" disabled={busy} onClick={()=>run(()=>reviewClaimAdmin(claim.id,'approved'),'Claim approved. Profile ownership does not grant sporting-history edit rights.')}>Approve</button><button disabled={busy} onClick={()=>run(()=>reviewClaimAdmin(claim.id,'rejected'),'Claim rejected.')}>Reject</button></div></article>)}</div>
      </details>}

      {canRoles&&<details className="panel-card">
        <summary><strong>Roles and Access Grants</strong><small>Reusable scoped capabilities</small></summary>
        <div className="detail-body">
          <div className="form-stack setup-subform"><h3>Custom role</h3><input placeholder="Role key" value={forms.role.roleKey} onChange={e=>updateForm('role','roleKey',e.target.value)}/><input placeholder="Display name" value={forms.role.name} onChange={e=>updateForm('role','name',e.target.value)}/><select value={forms.role.scopeType} onChange={e=>updateForm('role','scopeType',e.target.value)}><option value="organization">Organization</option><option value="event">Event</option><option value="team">Team</option></select><div className="permission-picker">{data.permissions.map(permission=>{const selected=rolePermissionKeys.includes(permission.key);return <button type="button" key={permission.key} className={selected?'permission-chip selected':'permission-chip'} title={permission.description} onClick={()=>setRolePermissionKeys(current=>selected?current.filter(key=>key!==permission.key):[...current,permission.key])}>{permission.key}</button>;})}</div><button disabled={busy||!forms.role.roleKey||!forms.role.name||rolePermissionKeys.length===0} onClick={()=>run(async()=>{const id=await createCustomRole(org.id,{roleKey:forms.role.roleKey,name:forms.role.name,scopeType:forms.role.scopeType as 'organization'|'event'|'team'});await setCustomRolePermissions(id,rolePermissionKeys);setRolePermissionKeys([]);},'Custom role and permissions created.')}>Create Role</button></div>
          <div className="membership-list">{customRoles.map(role=><article key={role.id}><div><strong>{role.name}</strong><small>{role.roleKey} · {role.scopeType} · {(data.rolePermissions[role.id]??[]).length} capabilities</small></div><div className="row-actions"><button onClick={()=>rename('role_definitions',role.id,role.name)}>Edit Name</button><button onClick={async()=>{const current=data.rolePermissions[role.id]??[];const raw=window.prompt('Comma separated permission keys',current.join(', '));if(raw===null)return;const keys=raw.split(',').map(value=>value.trim()).filter(key=>data.permissions.some(permission=>permission.key===key));await run(()=>setCustomRolePermissions(role.id,keys),'Role permissions updated.');}}>Edit Capabilities</button><button onClick={()=>active('role_definitions',role.id,!role.isActive)}>{role.isActive?'Disable':'Enable'}</button></div></article>)}</div>
          <div className="form-stack setup-subform"><h3>Organization access grant</h3><input placeholder="User UUID" value={forms.grant.userId} onChange={e=>updateForm('grant','userId',e.target.value)}/><select value={forms.grant.roleId} onChange={e=>updateForm('grant','roleId',e.target.value)}><option value="">Choose organization role</option>{organizationRoles.filter(role=>role.isActive).map(role=><option value={role.id} key={role.id}>{role.name}</option>)}</select><label>Optional expiry<input type="datetime-local" value={forms.grant.expiresAt} onChange={e=>updateForm('grant','expiresAt',e.target.value)}/></label><button disabled={busy||!forms.grant.userId||!forms.grant.roleId} onClick={()=>run(()=>assignAccessGrant({organizationId:org.id,userId:forms.grant.userId,roleId:forms.grant.roleId,expiresAt:forms.grant.expiresAt?new Date(forms.grant.expiresAt).toISOString():undefined}),'Access grant assigned.')}>Assign Grant</button></div>
          <div className="membership-list">{data.grants.map(grant=><article key={grant.id}><div><strong>{grant.roleName}</strong><small>User {grant.userId} {grant.expiresAt?'· expires '+new Date(grant.expiresAt).toLocaleString():''}</small></div><button disabled={busy} onClick={()=>run(()=>revokeAccessGrant(grant.id),'Access grant revoked.')}>Revoke</button></article>)}</div>
        </div>
      </details>}

      {canMerge&&<details className="panel-card">
        <summary><strong>Duplicate Merge</strong><small>Relationship-safe and audited</small></summary>
        <div className="detail-body form-stack"><p>Merging migrates supported relationships to the target and soft-retires the source. Source and target cannot be the same.</p><select value={forms.merge.entityType} onChange={e=>updateForm('merge','entityType',e.target.value)}><option value="fighter">Fighter</option><option value="team">Team</option><option value="club">Club</option></select><input placeholder="Source UUID" value={forms.merge.sourceId} onChange={e=>updateForm('merge','sourceId',e.target.value)}/><input placeholder="Target UUID" value={forms.merge.targetId} onChange={e=>updateForm('merge','targetId',e.target.value)}/><textarea rows={3} placeholder="Required reason" value={forms.merge.reason} onChange={e=>updateForm('merge','reason',e.target.value)}/><button className="danger" disabled={busy||!forms.merge.sourceId||!forms.merge.targetId||forms.merge.reason.trim().length<3||forms.merge.sourceId===forms.merge.targetId} onClick={()=>{if(window.confirm('Merge the source into the target? This is audited and the source will be soft-retired.'))run(()=>mergeAdmin(forms.merge.entityType as 'fighter'|'team'|'club',forms.merge.sourceId,forms.merge.targetId,forms.merge.reason).then(()=>undefined),'Duplicate merged safely.');}}>Merge Records</button></div>
      </details>}
    </div>
  </>;
}
