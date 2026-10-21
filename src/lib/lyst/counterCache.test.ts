import { describe, expect, it } from 'vitest';
import type { CounterState } from '../../data/lyst';
import { readCounterCache, saveCounterCache } from './counterCache';
const state: CounterState = {
  kind:'training',server_now:'2026-10-21T02:00:00Z',match_id:'fictional-fight',
  seat:{id:'fictional-seat',match_id:'fictional-fight',status:'active',side:'a',role:'learning',field_key:'field 1',operator:'Rehearsal Counter'},
  prepared_run:{id:'fictional-run',match_id:'fictional-fight',no:1,generation:1,status:'prepared',started_at:null}
};
const memory = () => {
  const rows=new Map<string,string>();
  return {getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);}};
};
describe('offline counter context',()=>{
  it('restores only the exact device/account and fight context',()=>{
    const disk=memory(); expect(saveCounterCache(disk,'phone-a',state)).toBe(true);
    expect(readCounterCache(disk,'phone-a')).toEqual(state); expect(readCounterCache(disk,'phone-b')).toBeNull();
  });
  it('does not restore final, waiting or closed events for offline counting',()=>{
    for(const extra of [{final:true},{waiting:true},{event:{id:'fictional-event',slug:'independent',name:'Independent',closed:true}}]){
      const disk=memory(); saveCounterCache(disk,'phone-a',{...state,...extra}); expect(readCounterCache(disk,'phone-a')).toBeNull();
    }
  });
  it('does not offer a run from another fight',()=>{
    const disk=memory(); saveCounterCache(disk,'phone-a',{...state,prepared_run:{...state.prepared_run!,match_id:'different-fight'}});
    expect(readCounterCache(disk,'phone-a')).toBeNull();
  });
  it('does not claim the phone cached anything when storage is denied or silently drops writes',()=>{
    expect(saveCounterCache({getItem:()=>null,setItem:()=>{}},'a',state)).toBe(false);
    expect(saveCounterCache({getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('quota');}},'a',state)).toBe(false);
  });
});
