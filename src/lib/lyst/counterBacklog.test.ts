import { describe,expect,it } from 'vitest';
import { CounterJournal } from './counterJournal';
import { recoverCounterBacklog } from './counterBacklog';
const disk=()=>{const rows=new Map<string,string>();return{get length(){return rows.size;},key:(i:number)=>[...rows.keys()][i]??null,getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);}};};
describe('saved evidence after seat replacement',()=>{
  it('delivers the previous seat using its original fight/run without changing the new seat',async()=>{
    const storage=disk(),old=new CounterJournal('old-seat',storage);old.setScope('old-fight');const action=old.add('tap',1,2,{runId:'old-run'});
    const next=new CounterJournal('new-seat',storage);next.setScope('next-fight');next.add('tap',1,1,{runId:'next-run'});
    const before=storage.getItem(next.key),sent:string[]=[];
    const waiting=await recoverCounterBacklog({storage,currentSeat:'new-seat',active:()=>true,retried:new Set(),track:()=>()=>{},withSeat:async(_s,work)=>work(),sender:seat=>async a=>{
      sent.push(`${seat}:${a.id}:${a.matchId}:${a.runId}`);return{status:'review',total:0,message:'Old round retained'};
    }});
    expect(sent).toEqual([`old-seat:${action.id}:old-fight:old-run`]);expect(waiting).toBe(0);
    expect(storage.getItem(next.key)).toBe(before);expect(new CounterJournal('old-seat',storage).held[0].delivered).toBe(true);
  });
  it('leaves an old journal untouched when another tab owns that seat',async()=>{
    const storage=disk(),j=new CounterJournal('old',storage);j.add('tap',1);const before=storage.getItem(j.key);
    await recoverCounterBacklog({storage,currentSeat:'next',active:()=>true,retried:new Set(),track:()=>()=>{},withSeat:async()=>{},sender:()=>async()=>{throw Error('must not send');}});
    expect(storage.getItem(j.key)).toBe(before);
  });
});
