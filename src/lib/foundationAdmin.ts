import type { AffiliationType, TeamType } from '../types';
import { supabase } from './supabase';

export interface AdminOrganization {
  id:string; name:string; shortName:string; region:string; countryCode?:string; websiteUrl?:string;
  isPublic:boolean; status:'active'|'inactive'; description?:string;
}
export interface AdminSeason {
  id:string; name:string; startsAt:string; endsAt:string; status:'draft'|'active'|'archived'; rulesetId?:string;
}
export interface AdminRuleset {
  id:string; name:string; shortName:string; version:string; status:'draft'|'published'|'retired';
  parentRulesetId?:string; settings:Record<string,unknown>;
}
export interface AdminDiscipline { id:string; code:string; name:string; competitionKind:'individual'|'team'|'hybrid'; isActive:boolean }
export interface AdminDivision { id:string; disciplineId:string; code:string; name:string; minimumFighters?:number; maximumFighters?:number; isActive:boolean }
export interface AdminCategory { id:string; divisionId:string; code:string; name:string; teamSize?:number; isActive:boolean }
export interface AdminClub { id:string; name:string; shortName?:string; countryCode?:string; provinceState?:string; city?:string; isActive:boolean }
export interface AdminTeam { id:string; clubId?:string; divisionId?:string; name:string; teamType:TeamType; countryCode?:string; isActive:boolean }
export interface AdminFighter { id:string; name:string; nickname?:string; countryCode?:string; teamId?:string; isTemporary:boolean; isActive:boolean; publicProfile:boolean }
export interface AdminClaim { id:string; fighterId:string; fighterName:string; userId:string; statement?:string; status:'pending'|'approved'|'rejected'|'cancelled'; createdAt:string }
export interface AdminRole { id:string; roleKey:string; name:string; scopeType:'platform'|'organization'|'event'|'team'; isSystem:boolean; isActive:boolean }
export interface AdminGrant { id:string; userId:string; roleId:string; roleName:string; createdAt:string; expiresAt?:string }
export interface AdminPermission { key:string; description:string }
export interface FoundationSnapshot {
  organization:AdminOrganization;
  seasons:AdminSeason[];
  rulesets:AdminRuleset[];
  disciplines:AdminDiscipline[];
  divisions:AdminDivision[];
  categories:AdminCategory[];
  clubs:AdminClub[];
  teams:AdminTeam[];
  fighters:AdminFighter[];
  claims:AdminClaim[];
  roles:AdminRole[];
  grants:AdminGrant[];
  permissions:AdminPermission[];
  rolePermissions:Record<string,string[]>;
}

function requireClient(){
  if(!supabase)throw new Error('Foundation administration requires a configured Supabase project.');
  return supabase;
}

export async function loadFoundationSnapshot(organizationId:string):Promise<FoundationSnapshot>{
  const client=requireClient();
  const [org,seasons,rulesets,disciplines,divisions,categories,clubs,teams,fighters,claims,roles,grants,permissions,rolePermissions]=await Promise.all([
    client.from('organizations').select('id,name,short_name,region,country_code,website_url,is_public,status,description').eq('id',organizationId).single(),
    client.from('seasons').select('id,name,starts_at,ends_at,status,ruleset_id').eq('organization_id',organizationId).is('deleted_at',null).order('starts_at',{ascending:false}),
    client.from('rulesets').select('id,name,short_name,version,status,parent_ruleset_id,settings').or('organization_id.is.null,organization_id.eq.'+organizationId).order('name'),
    client.from('disciplines').select('id,code,name,competition_kind,is_active').or('organization_id.is.null,organization_id.eq.'+organizationId).is('deleted_at',null).order('sort_order'),
    client.from('divisions').select('id,discipline_id,code,name,minimum_fighters,maximum_fighters,is_active').or('organization_id.is.null,organization_id.eq.'+organizationId).is('deleted_at',null).order('name'),
    client.from('competition_categories').select('id,division_id,code,name,team_size,is_active').or('organization_id.is.null,organization_id.eq.'+organizationId).is('deleted_at',null).order('name'),
    client.from('clubs').select('id,name,short_name,country_code,province_state,city,is_active').eq('organization_id',organizationId).is('deleted_at',null).order('name'),
    client.from('teams').select('id,club_id,division_id,name,team_type,country_code,is_active').eq('organization_id',organizationId).is('deleted_at',null).order('name'),
    client.from('fighters').select('id,name,nickname,country_code,team_id,is_temporary,is_active,public_profile').eq('organization_id',organizationId).is('deleted_at',null).order('name'),
    client.from('fighter_profile_claims').select('id,fighter_id,user_id,statement,status,created_at,fighters!inner(name,organization_id)').eq('fighters.organization_id',organizationId).order('created_at',{ascending:false}),
    client.from('role_definitions').select('id,role_key,name,scope_type,is_system,is_active').or('organization_id.is.null,organization_id.eq.'+organizationId).order('scope_type').order('name'),
    client.from('access_grants').select('id,user_id,role_id,created_at,expires_at,role_definitions(name)').eq('organization_id',organizationId).is('deleted_at',null).order('created_at',{ascending:false}),
    client.from('permissions').select('permission_key,description').order('permission_key'),
    client.from('role_permissions').select('role_id,permission_key')
  ]);
  const error=org.error||seasons.error||rulesets.error||disciplines.error||divisions.error||categories.error||clubs.error||teams.error||fighters.error||claims.error||roles.error||grants.error||permissions.error||rolePermissions.error;
  if(error)throw error;
  const o:any=org.data;
  return {
    organization:{id:o.id,name:o.name,shortName:o.short_name,region:o.region,countryCode:o.country_code??undefined,websiteUrl:o.website_url??undefined,isPublic:o.is_public,status:o.status,description:o.description??undefined},
    seasons:(seasons.data??[]).map((r:any)=>({id:r.id,name:r.name,startsAt:r.starts_at,endsAt:r.ends_at,status:r.status,rulesetId:r.ruleset_id??undefined})),
    rulesets:(rulesets.data??[]).map((r:any)=>({id:r.id,name:r.name,shortName:r.short_name,version:r.version,status:r.status,parentRulesetId:r.parent_ruleset_id??undefined,settings:r.settings??{}})),
    disciplines:(disciplines.data??[]).map((r:any)=>({id:r.id,code:r.code,name:r.name,competitionKind:r.competition_kind,isActive:r.is_active})),
    divisions:(divisions.data??[]).map((r:any)=>({id:r.id,disciplineId:r.discipline_id,code:r.code,name:r.name,minimumFighters:r.minimum_fighters??undefined,maximumFighters:r.maximum_fighters??undefined,isActive:r.is_active})),
    categories:(categories.data??[]).map((r:any)=>({id:r.id,divisionId:r.division_id,code:r.code,name:r.name,teamSize:r.team_size??undefined,isActive:r.is_active})),
    clubs:(clubs.data??[]).map((r:any)=>({id:r.id,name:r.name,shortName:r.short_name??undefined,countryCode:r.country_code??undefined,provinceState:r.province_state??undefined,city:r.city??undefined,isActive:r.is_active})),
    teams:(teams.data??[]).map((r:any)=>({id:r.id,clubId:r.club_id??undefined,divisionId:r.division_id??undefined,name:r.name,teamType:r.team_type,countryCode:r.country_code??undefined,isActive:r.is_active})),
    fighters:(fighters.data??[]).map((r:any)=>({id:r.id,name:r.name,nickname:r.nickname??undefined,countryCode:r.country_code??undefined,teamId:r.team_id??undefined,isTemporary:r.is_temporary,isActive:r.is_active,publicProfile:r.public_profile})),
    claims:(claims.data??[]).map((r:any)=>({id:r.id,fighterId:r.fighter_id,fighterName:(Array.isArray(r.fighters)?r.fighters[0]?.name:r.fighters?.name)??r.fighter_id,userId:r.user_id,statement:r.statement??undefined,status:r.status,createdAt:r.created_at})),
    roles:(roles.data??[]).map((r:any)=>({id:r.id,roleKey:r.role_key,name:r.name,scopeType:r.scope_type,isSystem:r.is_system,isActive:r.is_active})),
    grants:(grants.data??[]).map((r:any)=>({id:r.id,userId:r.user_id,roleId:r.role_id,roleName:(Array.isArray(r.role_definitions)?r.role_definitions[0]?.name:r.role_definitions?.name)??r.role_id,createdAt:r.created_at,expiresAt:r.expires_at??undefined})),
    permissions:(permissions.data??[]).map((r:any)=>({key:r.permission_key,description:r.description})),
    rolePermissions:(rolePermissions.data??[]).reduce((acc:Record<string,string[]>,r:any)=>{(acc[r.role_id]??=[]).push(r.permission_key);return acc;},{})
  };
}

export async function updateOrganization(input:AdminOrganization):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('organizations').update({
    name:input.name.trim(),short_name:input.shortName.trim(),region:input.region.trim(),
    country_code:input.countryCode?.trim().toUpperCase()||null,website_url:input.websiteUrl?.trim()||null,
    description:input.description?.trim()||null,is_public:input.isPublic,status:input.status
  }).eq('id',input.id);
  if(error)throw error;
}

export async function createSeasonAdmin(organizationId:string,input:{name:string;startsAt:string;endsAt:string}):Promise<void>{
  const client=requireClient();
  if(new Date(input.endsAt)<=new Date(input.startsAt))throw new Error('Season end must be after season start.');
  const {error}=await client.from('seasons').insert({organization_id:organizationId,name:input.name.trim(),starts_at:input.startsAt,ends_at:input.endsAt,status:'draft'});
  if(error)throw error;
}
export async function updateSeasonAdmin(id:string,input:Partial<{name:string;startsAt:string;endsAt:string;status:AdminSeason['status'];rulesetId:string|null}>):Promise<void>{
  const client=requireClient();
  const patch:any={};
  if(input.name!==undefined)patch.name=input.name.trim();
  if(input.startsAt!==undefined)patch.starts_at=input.startsAt;
  if(input.endsAt!==undefined)patch.ends_at=input.endsAt;
  if(input.status!==undefined)patch.status=input.status;
  if(input.rulesetId!==undefined)patch.ruleset_id=input.rulesetId;
  const {error}=await client.from('seasons').update(patch).eq('id',id);
  if(error)throw error;
}

export async function createRulesetAdmin(organizationId:string,input:{name:string;shortName:string;version:string;parentRulesetId?:string;settings:Record<string,unknown>}):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('rulesets').insert({organization_id:organizationId,name:input.name.trim(),short_name:input.shortName.trim(),version:input.version.trim(),parent_ruleset_id:input.parentRulesetId||null,status:'draft',settings:input.settings});
  if(error)throw error;
}
export async function setRulesetAdminStatus(id:string,status:'published'|'retired'):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('rulesets').update({status}).eq('id',id);
  if(error)throw error;
}

export async function createDisciplineAdmin(organizationId:string,input:{code:string;name:string;competitionKind:AdminDiscipline['competitionKind']}):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('disciplines').insert({organization_id:organizationId,code:input.code.trim(),name:input.name.trim(),competition_kind:input.competitionKind});
  if(error)throw error;
}
export async function createDivisionAdmin(organizationId:string,input:{disciplineId:string;code:string;name:string;minimumFighters?:number;maximumFighters?:number}):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('divisions').insert({organization_id:organizationId,discipline_id:input.disciplineId,code:input.code.trim(),name:input.name.trim(),minimum_fighters:input.minimumFighters??null,maximum_fighters:input.maximumFighters??null});
  if(error)throw error;
}
export async function createCategoryAdmin(organizationId:string,input:{divisionId:string;code:string;name:string;teamSize?:number}):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('competition_categories').insert({organization_id:organizationId,division_id:input.divisionId,code:input.code.trim(),name:input.name.trim(),team_size:input.teamSize??null});
  if(error)throw error;
}
export async function createClubAdmin(organizationId:string,input:{name:string;shortName?:string;countryCode?:string;provinceState?:string;city?:string}):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('clubs').insert({organization_id:organizationId,name:input.name.trim(),short_name:input.shortName?.trim()||null,country_code:input.countryCode?.trim().toUpperCase()||null,province_state:input.provinceState?.trim()||null,city:input.city?.trim()||null});
  if(error)throw error;
}
export async function createTeamAdmin(organizationId:string,input:{name:string;clubId?:string;divisionId?:string;teamType:TeamType;countryCode?:string}):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('teams').insert({organization_id:organizationId,name:input.name.trim(),club_id:input.clubId||null,division_id:input.divisionId||null,team_type:input.teamType,country_code:input.countryCode?.trim().toUpperCase()||null});
  if(error)throw error;
}
export async function createFighterAdmin(organizationId:string,input:{name:string;nickname?:string;countryCode?:string;teamId?:string;isTemporary:boolean;publicProfile:boolean}):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('fighters').insert({organization_id:organizationId,name:input.name.trim(),nickname:input.nickname?.trim()||null,country_code:input.countryCode?.trim().toUpperCase()||null,team_id:input.teamId||null,is_temporary:input.isTemporary,public_profile:input.publicProfile,preferred_weapons:[]});
  if(error)throw error;
}

type ToggleTable='disciplines'|'divisions'|'competition_categories'|'clubs'|'teams'|'fighters'|'role_definitions';
export async function setFoundationActive(table:ToggleTable,id:string,isActive:boolean):Promise<void>{
  const client=requireClient();
  const {error}=await client.from(table).update({is_active:isActive}).eq('id',id);
  if(error)throw error;
}

type RenameTable='disciplines'|'divisions'|'competition_categories'|'clubs'|'teams'|'fighters'|'role_definitions';
export async function renameFoundationRecord(table:RenameTable,id:string,name:string):Promise<void>{
  const client=requireClient();
  const cleaned=name.trim();
  if(cleaned.length<2)throw new Error('Name must contain at least two characters.');
  const {error}=await client.from(table).update({name:cleaned}).eq('id',id);
  if(error)throw error;
}

export async function createFighterAffiliation(input:{
  fighterId:string; organizationId:string; clubId?:string; teamId?:string; seasonId?:string; eventId?:string;
  affiliationType:AffiliationType; startsOn?:string; endsOn?:string; isPrimary:boolean;
}):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('fighter_affiliations').insert({
    fighter_id:input.fighterId,organization_id:input.organizationId,club_id:input.clubId||null,team_id:input.teamId||null,
    season_id:input.seasonId||null,event_id:input.eventId||null,affiliation_type:input.affiliationType,
    starts_on:input.startsOn||null,ends_on:input.endsOn||null,is_primary:input.isPrimary
  });
  if(error)throw error;
}

export async function reviewClaimAdmin(claimId:string,status:'approved'|'rejected',notes?:string):Promise<void>{
  const client=requireClient();
  const {error}=await client.rpc('review_fighter_profile_claim',{p_claim_id:claimId,p_status:status,p_decision_notes:notes?.trim()||null});
  if(error)throw error;
}

export async function mergeAdmin(entityType:'fighter'|'team'|'club',sourceId:string,targetId:string,reason:string):Promise<string>{
  const client=requireClient();
  const {data,error}=await client.rpc('merge_identity_records',{p_entity_type:entityType,p_source_id:sourceId,p_target_id:targetId,p_reason:reason});
  if(error)throw error;
  return String(data);
}

export async function createCustomRole(organizationId:string,input:{roleKey:string;name:string;scopeType:'organization'|'event'|'team'}):Promise<string>{
  const client=requireClient();
  const key=input.roleKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g,'_');
  const {data,error}=await client.from('role_definitions').insert({role_key:organizationId.slice(0,8)+'_'+key,name:input.name.trim(),scope_type:input.scopeType,organization_id:organizationId,is_system:false}).select('id').single();
  if(error)throw error;
  return data.id;
}

export async function assignAccessGrant(input:{organizationId:string;userId:string;roleId:string;expiresAt?:string}):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('access_grants').insert({organization_id:input.organizationId,user_id:input.userId,role_id:input.roleId,expires_at:input.expiresAt||null});
  if(error)throw error;
}
export async function revokeAccessGrant(id:string):Promise<void>{
  const client=requireClient();
  const {error}=await client.from('access_grants').update({deleted_at:new Date().toISOString()}).eq('id',id);
  if(error)throw error;
}


export async function setCustomRolePermissions(roleId:string,permissionKeys:string[]):Promise<void>{
  const client=requireClient();
  const {error:deleteError}=await client.from('role_permissions').delete().eq('role_id',roleId);
  if(deleteError)throw deleteError;
  if(permissionKeys.length===0)return;
  const {error:insertError}=await client.from('role_permissions').insert(permissionKeys.map(permission_key=>({role_id:roleId,permission_key})));
  if(insertError)throw insertError;
}
