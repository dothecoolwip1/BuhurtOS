export interface ScheduleAssignment {
  id:string;
  startsAt:string;
  endsAt:string;
  ringId?:string;
  participantIds:string[];
}

export interface ScheduleConflict {
  firstId:string;
  secondId:string;
  participantIds:string[];
  reason:'participant_overlap'|'ring_overlap';
}

export function detectScheduleConflicts(items:ScheduleAssignment[]):ScheduleConflict[]{
  const conflicts:ScheduleConflict[]=[];
  const normalized=items.map(item=>({...item,start:new Date(item.startsAt).getTime(),end:new Date(item.endsAt).getTime()}));
  for(const item of normalized){
    if(!Number.isFinite(item.start)||!Number.isFinite(item.end)||item.end<=item.start) throw new Error(`Invalid schedule interval for ${item.id}.`);
  }
  for(let a=0;a<normalized.length;a++)for(let b=a+1;b<normalized.length;b++){
    const left=normalized[a],right=normalized[b];
    if(left.start>=right.end||right.start>=left.end)continue;
    const shared=left.participantIds.filter(id=>right.participantIds.includes(id));
    if(shared.length)conflicts.push({firstId:left.id,secondId:right.id,participantIds:shared,reason:'participant_overlap'});
    if(left.ringId&&left.ringId===right.ringId)conflicts.push({firstId:left.id,secondId:right.id,participantIds:[],reason:'ring_overlap'});
  }
  return conflicts;
}
