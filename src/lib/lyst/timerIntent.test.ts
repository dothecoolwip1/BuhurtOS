import { describe,expect,it } from 'vitest';
import { definiteTimerRefusal,TimerIntentStore,type TimerIntent } from './timerIntent';
const disk=()=>{const rows=new Map<string,string>();return{getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);},removeItem:(k:string)=>{rows.delete(k);}};};
const intent:TimerIntent={savedAt:1000,command:{eventId:'fictional-event',field:'field 1',matchId:'fictional-fight',expectedRev:0,command:'same-command',action:'start',mode:'fight',round:1,durationMs:60000,requestedAt:'2026-10-21T02:00:00.000Z'}};
describe('uncertain clock actions',()=>{
  it('distinguishes rolled-back refusals from a lost response',()=>{
    expect(definiteTimerRefusal({code:'P0001',message:'COUNTERS_NOT_PREPARED'})).toBe('preparation');
    expect(definiteTimerRefusal({code:'42501',message:'No access'})).toBe('refused');
    expect(definiteTimerRefusal({status:503,message:'Lost reply'})).toBeNull();
    expect(definiteTimerRefusal(new Error('aborted'))).toBeNull();
  });
  it('allows memory continuation when a resolved action cannot be removed, preserving its saved copy',()=>{
    const storage=disk(),s=new TimerIntentStore({...storage,removeItem:()=>{throw Error('blocked');}},'organizer','fictional-fight');s.save(intent);
    expect(s.clear()).toBe(true);expect(s.read()).toBeNull();expect(s.problem).toMatch(/memory only/);
    const next={...intent,command:{...intent.command,command:'next-command'}};
    expect(s.save(next)).toBe(false);expect(s.read()).toEqual(next);
    expect(new TimerIntentStore(storage,'organizer','fictional-fight').read()).toEqual(intent);
  });
  it('preserves an unreadable original while allowing explicit checked memory continuation',()=>{
    const storage=disk();const key='bos-timer-intent:v1:organizer:fictional-fight';storage.setItem(key,'{broken original');
    const s=new TimerIntentStore(storage,'organizer','fictional-fight');
    expect(s.requiresCheck).toBe(true);expect(s.unreadableRaw).toBe('{broken original');
    expect(()=>s.save(intent)).toThrow(/read/);expect(s.clear()).toBe(false);
    s.continueAfterClockCheck();expect(s.save(intent)).toBe(false);expect(s.read()).toEqual(intent);
    expect(s.clear()).toBe(true);expect(s.read()).toBeNull();
    expect(storage.getItem(key)).toBe('{broken original');
    expect(new TimerIntentStore(storage,'organizer','fictional-fight').requiresCheck).toBe(true);
  });
  it('keeps the exact ID, press time and payload after a reload',()=>{
    const storage=disk(),s=new TimerIntentStore(storage,'organizer','fictional-fight');
    expect(s.save(intent)).toBe(true);
    expect(new TimerIntentStore(storage,'organizer','fictional-fight').read()).toEqual(intent);
    expect(new TimerIntentStore(storage,'other-user','fictional-fight').read()).toBeNull();
  });
  it('refuses a second command while the first response is uncertain',()=>{
    const s=new TimerIntentStore(disk(),'organizer','fictional-fight');s.save(intent);
    expect(()=>s.save({...intent,command:{...intent.command,command:'different-command'}})).toThrow(/pending/);
    expect(s.read()).toEqual(intent);
  });
  it('clears only after acknowledgement or the operator checks the clock',()=>{
    const storage=disk(),s=new TimerIntentStore(storage,'organizer','fictional-fight');s.save(intent);s.clear();
    expect(new TimerIntentStore(storage,'organizer','fictional-fight').read()).toBeNull();
  });
  it('retains the command in memory and warns when durable storage fails',()=>{
    const s=new TimerIntentStore({getItem:()=>null,setItem:()=>{throw Error('quota');},removeItem:()=>{}},'organizer','fictional-fight');
    expect(s.save(intent)).toBe(false);expect(s.read()).toEqual(intent);expect(s.problem).toMatch(/memory only/);
  });
});
