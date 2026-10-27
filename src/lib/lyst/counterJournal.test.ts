import { describe, expect, it } from 'vitest';
import { CounterJournal, type CounterStorage } from './counterJournal';
import type { CounterSend } from './counters';
import { readCounterCorrection } from './counters';

const memory = () => {
  const values = new Map<string, string>();
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
};
describe('counter evidence through failures', () => {
  it('does not render malformed counter-reported correction metadata',()=>{
    expect(readCounterCorrection({id:'c',from:{unexpected:'object'},to:2})).toBeNull();
    expect(readCounterCorrection({id:'c',from:35,to:-1})).toBeNull();
    expect(readCounterCorrection({id:'c',from:35,to:37})).toEqual({id:'c',from:35,to:37});
  });
  it('edits a weighted total using explicit review actions without rewriting accepted taps', async()=>{
    const disk=memory(),j=new CounterJournal('s',disk);
    j.setScope('fight');
    j.add('tap',1,1,{runId:'r'});j.add('tap',1,2,{runId:'r'});
    let total=0;
    await j.flush(async a=>({status:'ok',total:total+=a.kind==='tap'?a.weight:0}));
    j.correctTotal(1,'r',2,{recordedAt:'2026-10-27T17:00:00Z'});
    expect(j.total(1)).toBe(3);expect(j.display(1,'r')).toBe(2);
    expect(j.pending.map(a=>a.kind)).toEqual(['undo','tap']);
    expect(j.pending[0].undoWeight).toBe(2);
    expect(j.pending.every(a=>a.recovery && a.matchId==='fight' && a.correction?.from===3 && a.correction.to===2)).toBe(true);
    const ids=j.pending.map(a=>a.id);
    await j.flush(async()=>({status:'offline'}));
    const reloaded=new CounterJournal('s',disk);reloaded.setScope('fight');
    expect(reloaded.display(1,'r')).toBe(2);expect(reloaded.pending.map(a=>a.id)).toEqual(ids);
    await reloaded.flush(async()=>({status:'review',total:3,message:'Correction needs marshal review.'}));
    reloaded.correctTotal(1,'r',2);
    expect(reloaded.pending).toHaveLength(0);expect(reloaded.held.map(h=>h.action.id)).toEqual(ids);
    expect(reloaded.total(1)).toBe(3);expect(reloaded.display(1,'r')).toBe(2);
    reloaded.setScope('next-fight');expect(reloaded.display(1,'next-run')).toBe(0);
  });
  it('can edit an offline-start total up and down while preserving original evidence',async()=>{
    const j=new CounterJournal('s',memory());
    const first=j.add('tap',2,2,{runId:'r',recovery:true});
    await j.flush(async()=>({status:'review',total:0,message:'Offline start.'}));
    j.correctTotal(2,'r',5);expect(j.display(2,'r')).toBe(5);
    j.correctTotal(2,'r',0);expect(j.display(2,'r')).toBe(0);
    expect(j.held[0].action).toEqual(first);expect(j.total(2)).toBe(0);
  });
  it('refuses invalid totals, unknown accepted tap order and inactive tabs without changing the journal',()=>{
    const j=new CounterJournal('s',memory());
    for(const n of [-1,1.5,1001,NaN])expect(()=>j.correctTotal(1,'r',n)).toThrow();
    expect(j.pending).toHaveLength(0);
    j.acceptSnapshot(1,4,j.revision);
    expect(()=>j.correctTotal(1,'r',3)).toThrow('tap order');expect(j.total(1)).toBe(4);expect(j.pending).toHaveLength(0);
    j.close();expect(()=>j.correctTotal(1,'r',4)).toThrow('no longer owns');
  });
  it('preserves selected undeliverable pending actions as a local marshal archive after ended access',()=>{
    const storage=memory(),j=new CounterJournal('ended-seat',storage),a=j.add('tap',1,2),b=j.add('tap',1);
    expect(j.archiveShownEvidence(new Set([a.id]),true)).toBe(true);
    const restored=new CounterJournal('ended-seat',storage);
    expect(restored.pending.map(x=>x.id)).toEqual([b.id]);expect(restored.held[0].action).toEqual(a);
    expect(restored.held[0].archivedAt).toBeTruthy();expect(restored.held[0].delivered).not.toBe(true);
  });
  it('cannot overwrite a new tab owner when an old in-flight response arrives', async () => {
    const disk=memory(),old=new CounterJournal('s',disk);const first=old.add('tap',1);
    let resolve!:(r:Awaited<ReturnType<CounterSend>>)=>void;
    const sending=old.flush(()=>new Promise(r=>{resolve=r;}));old.close();
    const owner=new CounterJournal('s',disk);const second=owner.add('tap',1);
    const saved=disk.getItem(owner.key);resolve({status:'ok',total:1});await sending;
    expect(disk.getItem(owner.key)).toBe(saved);expect(owner.pending.map(a=>a.id)).toEqual([first.id,second.id]);
    await owner.flush(async a=>({status:a.id===first.id?'duplicate':'ok',total:a.id===first.id?1:2}));
    expect(owner.display(1)).toBe(2);
  });
  it('keeps weighted offline-start undo consistent after review delivery and reload',async()=>{
    const disk=memory(),j=new CounterJournal('s',disk);const context={recovery:true,runId:'prepared-run'};
    j.add('tap',1,2,context);await j.flush(async()=>({status:'review',total:0,message:'marshal-started'}));
    const connected=new CounterJournal('s',disk);connected.add('tap',1,1,context);
    connected.add('undo',1,1,context);expect(connected.display(1,'prepared-run')).toBe(2);
    await connected.flush(async()=>({status:'review',total:0,message:'marshal-started'}));
    connected.add('undo',1,1,context);expect(connected.display(1,'prepared-run')).toBe(0);
    expect(connected.pending[0].undoWeight).toBe(2);
  });
  it('can save again after quota clears and preserves the unreadable original in a copy',()=>{
    const disk=memory();let quota=true;
    const j=new CounterJournal('s',{getItem:disk.getItem,setItem:(k,v)=>{if(quota)throw Error('quota');disk.setItem(k,v);}});
    j.add('tap',1);quota=false;j.add('tap',1);
    expect(j.durable).toBe(true);expect(new CounterJournal('s',disk).display(1)).toBe(2);
    disk.values.set(j.key,'{exact broken');const broken=new CounterJournal('s',disk);broken.add('tap',1);
    expect(JSON.parse(broken.export()).unreadableSavedRecord).toBe('{exact broken');
    expect(disk.getItem(j.key)).toBe('{exact broken');
  });
  it('restores the last confirmed total plus pending counts after offline reload', async () => {
    const disk = memory(); const j = new CounterJournal('fictional-seat', disk);
    j.acceptSnapshot(1, 2, j.revision); j.add('tap', 1);
    await j.flush(async () => ({ status: 'offline' }));
    const restored = new CounterJournal('fictional-seat', disk);
    expect(restored.display(1)).toBe(3);
    expect(restored.pending).toHaveLength(1);
    // This could already include a tap whose response was lost: do not add it.
    expect(restored.acceptSnapshot(1, 3, restored.revision)).toBe(false);
    await restored.flush(async () => ({ status: 'duplicate', total: 3 }));
    expect(restored.display(1)).toBe(3); expect(restored.pending).toHaveLength(0);
    expect(new CounterJournal('fictional-seat', disk).display(1)).toBe(3);
  });
  it('writes after every acknowledged command, before sending the next one', async () => {
    const disk = memory(); const j = new CounterJournal('s', disk);
    j.add('tap', 1, 2); j.add('tap', 1);
    let calls = 0;
    await j.flush(async () => {
      if (++calls === 2) {
        const afterCrash = new CounterJournal('s', disk);
        expect(afterCrash.total(1)).toBe(2); expect(afterCrash.pending).toHaveLength(1);
        expect(afterCrash.display(1)).toBe(3);
        return { status: 'offline' };
      }
      return { status: 'ok', total: 2 };
    });
  });
  it('concurrent pump and Done await the same send and do not duplicate IDs', async () => {
    const j = new CounterJournal('s', memory()); const a = j.add('tap', 1);
    let resolve!: (r: Awaited<ReturnType<CounterSend>>) => void;
    const sent: string[] = [];
    const send: CounterSend = command => { sent.push(command.id); return new Promise(r => { resolve = r; }); };
    const pumping = j.flush(send); const done = j.flush(send);
    expect(done).toBe(pumping); expect(j.sending).toBe(true);
    resolve({ status: 'ok', total: 1 }); await done;
    expect(sent).toEqual([a.id]); expect(j.pending).toHaveLength(0); expect(j.sending).toBe(false);
  });
  it('keeps ended-round evidence and undo in order for marshal review', async () => {
    const disk = memory(); const j = new CounterJournal('s', disk);
    j.add('tap', 1, 2); j.add('undo', 1);
    await j.flush(async () => ({ status: 'refused', reason: 'ROUND_ENDED', message: 'The round ended.' }));
    expect(j.pending).toHaveLength(0); expect(j.held.map(h => h.action.kind)).toEqual(['tap', 'undo']);
    expect(new CounterJournal('s', disk).held).toEqual(j.held);
    expect(JSON.parse(j.export()).seatId).toBe('s');
  });
  it('waits when the start has not arrived, preserving the same command IDs', async () => {
    const j = new CounterJournal('s', memory()); const a = j.add('tap', 1);
    await j.flush(async () => ({ status: 'refused', reason: 'ROUND_NOT_STARTED', message: 'Wait for start.' }));
    expect(j.pending[0]).toEqual(a); expect(j.held).toHaveLength(0);
    await j.flush(async command => { expect(command.id).toBe(a.id); return { status: 'ok', total: 1 }; });
    expect(j.display(1)).toBe(1);
  });
  it('sets aside old rounds, never carrying their points into a new round', () => {
    const disk = memory(); const j = new CounterJournal('s', disk);
    j.add('tap', 1, 2); j.holdOtherRounds(2); j.add('tap', 2);
    expect(j.display(2)).toBe(1); expect(j.held[0].action.round).toBe(1);
    expect(new CounterJournal('s', disk).held).toHaveLength(1);
    expect(new CounterJournal('other-seat', disk).display(2)).toBe(0);
  });
  it('storage quota errors remain visible while the in-memory evidence remains copyable', () => {
    const disk: CounterStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const j = new CounterJournal('s', disk); j.add('tap', 1);
    expect(j.durable).toBe(false); expect(j.storageProblem).toBe('quota'); expect(j.display(1)).toBe(1);
    expect(JSON.parse(j.export()).pending).toHaveLength(1);
  });
  it('does not overwrite unreadable saved evidence', () => {
    const disk = memory(); disk.values.set('bos-counter-journal:v1:s', '{interrupted');
    const j = new CounterJournal('s', disk); j.add('tap', 1);
    expect(j.durable).toBe(false); expect(disk.getItem(j.key)).toBe('{interrupted');
  });
  it('refuses a stale snapshot requested before a new tap', () => {
    const j = new CounterJournal('s', memory()); const rev = j.revision;
    j.add('tap', 1); j.holdOtherRounds(2);
    expect(j.acceptSnapshot(2, 9, rev)).toBe(false);
  });
  it('keeps a carried seat’s totals and pending evidence separated by fight', async () => {
    const disk = memory(); const j = new CounterJournal('s', disk);
    j.setScope('fictional-fight-a'); j.acceptSnapshot(1, 8, j.revision);
    const a = j.add('tap', 1, 2, { runId: 'run-a' });
    j.setScope('fictional-fight-b'); j.add('tap', 1, 1, { runId: 'run-b' });
    expect(j.display(1, 'run-b')).toBe(1);
    await j.flush(async action => action.id === a.id ? { status: 'duplicate', total: 10 } : { status: 'ok', total: 1 });
    expect(j.display(1, 'run-b')).toBe(1);
    j.setScope('fictional-fight-a'); expect(j.total(1)).toBe(10);
    const restored = new CounterJournal('s', disk); restored.setScope('fictional-fight-b');
    expect(restored.total(1)).toBe(1);
  });
  it('does not add a refused tap to the running count', async () => {
    const j = new CounterJournal('s', memory()); j.acceptSnapshot(1, 2, j.revision); j.add('tap', 1, 2);
    await j.flush(async () => ({ status: 'refused', reason: 'OTHER', message: 'not allowed' }));
    expect(j.display(1)).toBe(2); expect(j.held).toHaveLength(1);
  });
  it('shows provisional offline evidence separately from accepted counts across a recount', async () => {
    const j = new CounterJournal('s', memory()); j.add('tap', 1, 2, { recovery: true, runId: 'old-run' });
    await j.flush(async () => ({ status: 'review', total: 0, message: 'review timing' }));
    expect(j.display(1, 'old-run')).toBe(2);
    expect(j.display(1, 'new-run')).toBe(0); expect(j.total(1)).toBe(0);
  });
  it('undoes two locally when the most recent pending or accepted strike was two', async () => {
    const j = new CounterJournal('s', memory()); j.add('tap', 1, 2); j.add('undo', 1);
    expect(j.display(1)).toBe(0);
    await j.flush(async a => ({ status: 'ok', total: a.kind === 'tap' ? 2 : 0 }));
    j.add('tap', 1, 2); await j.flush(async () => ({ status: 'ok', total: 2 }));
    j.add('undo', 1); expect(j.display(1)).toBe(0);
  });
});
