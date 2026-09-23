import type { FighterAffiliation } from '../types';

function day(value?:string):number|undefined{
  if(!value)return undefined;
  const parsed=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(parsed)?parsed:undefined;
}

export function affiliationIsActiveAt(affiliation:FighterAffiliation,at:Date):boolean{
  const point=Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),at.getUTCDate());
  const start=day(affiliation.startsOn);
  const end=day(affiliation.endsOn);
  return (start===undefined||start<=point)&&(end===undefined||end>=point);
}

export function affiliationsAt(
  affiliations:FighterAffiliation[],
  at:Date,
  options?:{eventId?:string;seasonId?:string}
):FighterAffiliation[]{
  return affiliations.filter(item=>
    affiliationIsActiveAt(item,at)
    && (!options?.eventId||!item.eventId||item.eventId===options.eventId)
    && (!options?.seasonId||!item.seasonId||item.seasonId===options.seasonId)
  );
}

export interface TemporaryFighterInput {
  displayName:string;
  countryCode?:string;
  teamId?:string;
  divisionId?:string;
}

export function normalizeTemporaryFighterInput(input:TemporaryFighterInput):Required<Pick<TemporaryFighterInput,'displayName'>> & Omit<TemporaryFighterInput,'displayName'>{
  const displayName=input.displayName.trim().replace(/\s+/g,' ');
  if(displayName.length<2)throw new Error('Temporary fighter name is required.');
  const countryCode=input.countryCode?.trim().toUpperCase()||undefined;
  if(countryCode&&!/^[A-Z]{2}$/.test(countryCode))throw new Error('Country code must use two letters.');
  return {displayName,countryCode,teamId:input.teamId||undefined,divisionId:input.divisionId||undefined};
}
