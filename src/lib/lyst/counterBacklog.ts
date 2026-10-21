import { CounterJournal,type CounterStorage } from './counterJournal';
import { JOURNAL_PREFIX,LEGACY_PREFIX,listKeys,type KeyedStorage } from './localEvidence';
import type { CounterSend } from './counters';

export async function recoverCounterBacklog(options:{
  storage:CounterStorage&KeyedStorage;currentSeat:string;active:()=>boolean;
  withSeat:(seat:string,work:()=>Promise<void>)=>Promise<void>;
  sender:(seat:string)=>CounterSend;retried: Set<string>;track:(journal:CounterJournal)=>()=>void;
}){
  const {storage,currentSeat,active,withSeat,sender,retried,track}=options;
  const seats=new Set(listKeys(storage).filter(k=>k.startsWith(JOURNAL_PREFIX)||k.startsWith(LEGACY_PREFIX))
    .map(k=>k.startsWith(JOURNAL_PREFIX)?k.slice(JOURNAL_PREFIX.length):k.slice(LEGACY_PREFIX.length)).filter(s=>s&&s!==currentSeat&&!/(^|:)probe(:|$)/.test(s)));
  let waiting=0;
  for(const seat of seats){
    if(!active())break;
    await withSeat(seat,async()=>{
      if(!active())return;
      const journal=new CounterJournal(seat,storage),untrack=track(journal);
      try{
        const ids=new Set(journal.held.filter(h=>!h.delivered&&!h.archivedAt&&!retried.has(h.action.id)).map(h=>h.action.id));
        ids.forEach(id=>retried.add(id));journal.retryHeld(ids);
        if(journal.pending.length)await journal.flush(sender(seat));
        waiting+=journal.pending.length+journal.held.filter(h=>!h.delivered&&!h.archivedAt).length;
      }finally{journal.close();untrack();}
    });
  }
  return waiting;
}
