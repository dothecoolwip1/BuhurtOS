import type { MatchRecord, RankingConfiguration, RosterEntry } from '../types';
import { computeEloRankings } from './ranking';
import { supabase } from './supabase';

export interface RankingDisplayEntry {
  competitorId:string;
  name:string;
  rank:number;
  previousRank?:number;
  rating:number;
  matches:number;
  eligible:boolean;
  explanation:Record<string,unknown>;
}

const CONFIG_KEY='buhurtos-demo-ranking-configs';
const SNAPSHOT_KEY='buhurtos-demo-ranking-snapshots';

const defaultDemo=(organizationId:string,seasonId:string):RankingConfiguration=>({
  id:'ranking-demo-elo',organizationId,seasonId,name:'Season Elo',scope:'season',version:1,
  formula:{type:'elo',initialRating:1500,kFactor:32,provisionalKFactor:40,provisionalMatches:3},minimumMatches:1,isPublic:true
});

export async function listRankingConfigurations(organizationId:string,seasonId:string):Promise<RankingConfiguration[]>{
  if(!supabase){
    const stored=typeof localStorage==='undefined'?null:localStorage.getItem(CONFIG_KEY);
    const rows:RankingConfiguration[]=stored?JSON.parse(stored):[defaultDemo(organizationId,seasonId)];
    return rows.filter(r=>r.organizationId===organizationId&&r.seasonId===seasonId);
  }
  const {data,error}=await supabase.from('ranking_configs').select('*').eq('organization_id',organizationId).eq('season_id',seasonId).order('name').order('version',{ascending:false});
  if(error)throw error;
  return (data??[]).map((r:any)=>({id:r.id,organizationId:r.organization_id??undefined,seasonId:r.season_id??undefined,name:r.name,scope:r.scope,disciplineKey:r.discipline_key??undefined,version:r.version,formula:r.formula??{},minimumMatches:r.minimum_matches,isPublic:r.is_public}));
}

export async function createRankingConfiguration(input:Omit<RankingConfiguration,'id'>):Promise<RankingConfiguration>{
  const row={...input,id:crypto.randomUUID()};
  if(!supabase){
    const current:RankingConfiguration[]=JSON.parse(localStorage.getItem(CONFIG_KEY)??'[]');
    localStorage.setItem(CONFIG_KEY,JSON.stringify([...current,row]));return row;
  }
  const {data,error}=await supabase.from('ranking_configs').insert({
    organization_id:input.organizationId??null,season_id:input.seasonId??null,name:input.name,scope:input.scope,discipline_key:input.disciplineKey??null,
    version:input.version,formula:input.formula,minimum_matches:input.minimumMatches,is_public:input.isPublic
  }).select('*').single();
  if(error)throw error;
  return {...row,id:data.id};
}

function permanentMatches(matches:MatchRecord[],roster:RosterEntry[]):MatchRecord[]{
  const fighterByRoster=new Map(roster.filter(r=>r.fighterId).map(r=>[r.id,r.fighterId!]));
  return matches.map(match=>({...match,participants:match.participants.map(p=>({...p,rosterEntryId:p.rosterEntryId?fighterByRoster.get(p.rosterEntryId):undefined}))}));
}
function fighterNameMap(roster:RosterEntry[]):Map<string,string>{
  return new Map(roster.filter(r=>r.fighterId).map(r=>[r.fighterId!,r.displayName]));
}

export async function rebuildRanking(config:RankingConfiguration,matches:MatchRecord[],roster:RosterEntry[]):Promise<RankingDisplayEntry[]>{
  if(!supabase){
    if(config.formula.type!=='elo')throw new Error('Demo ranking preview currently supports Elo formulas.');
    const rows=computeEloRankings(permanentMatches(matches,roster),{
      initialRating:Number(config.formula.initialRating??1500),kFactor:Number(config.formula.kFactor??32),minimumMatches:config.minimumMatches,
      provisionalKFactor:Number(config.formula.provisionalKFactor??config.formula.kFactor??32),provisionalMatches:Number(config.formula.provisionalMatches??0)
    });
    const names=fighterNameMap(roster);
    const previousRaw=localStorage.getItem(SNAPSHOT_KEY);
    const previous:RankingDisplayEntry[]=previousRaw?JSON.parse(previousRaw):[];
    const display=rows.map((row,index)=>({
      competitorId:row.competitorId,name:names.get(row.competitorId)??row.competitorId,rank:index+1,
      previousRank:previous.find(p=>p.competitorId===row.competitorId)?.rank,rating:row.rating,matches:row.matches,eligible:row.eligible,
      explanation:{wins:row.wins,losses:row.losses,draws:row.draws,minimumMatches:config.minimumMatches,contributions:row.contributions}
    }));
    localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(display));return display;
  }
  const {data,error}=await supabase.rpc('rebuild_elo_ranking',{p_config_id:config.id});
  if(error)throw error;
  return loadRankingSnapshot(String(data));
}

export async function loadRankingSnapshot(snapshotId:string):Promise<RankingDisplayEntry[]>{
  if(!supabase){
    const raw=typeof localStorage==='undefined'?null:localStorage.getItem(SNAPSHOT_KEY);
    return raw?JSON.parse(raw):[];
  }
  const {data,error}=await supabase.from('ranking_snapshot_entries').select('*,fighter:fighters(display_name)').eq('snapshot_id',snapshotId).order('rank');
  if(error)throw error;
  return (data??[]).map((r:any)=>({competitorId:r.fighter_id??r.team_id,name:r.fighter?.display_name??r.team_id??'Unknown',rank:r.rank,previousRank:r.previous_rank??undefined,rating:Number(r.rating),matches:r.matches_counted,eligible:Boolean(r.explanation?.eligible??true),explanation:r.explanation??{}}));
}

export async function loadLatestRanking(configId:string):Promise<RankingDisplayEntry[]>{
  if(!supabase)return loadRankingSnapshot('demo');
  const {data,error}=await supabase.from('ranking_snapshots').select('id').eq('ranking_config_id',configId).order('calculated_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  return data?.id?loadRankingSnapshot(data.id):[];
}
