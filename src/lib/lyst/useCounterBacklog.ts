import { useEffect,useState } from 'react';
import { recoverCounterBacklog } from './counterBacklog';
import { counterEvidenceSender } from './sendCounterEvidence';
import type { CounterJournal } from './counterJournal';

/** New fights receive new seats. Keep delivering the old seats' saved work in
 * their own journals and under their own locks, without carrying their tally. */
export function useCounterBacklog(currentSeat:string,enabled:boolean){
  const [note,setNote]=useState<string|null>(null);
  useEffect(()=>{
    if(!enabled)return;
    if(!navigator.locks){
      setNote('This browser cannot safely retry older counter records across tabs. Open Saved counter evidence and show any undelivered counts to the marshal.');
      return;
    }
    let live=true,busy=false;
    const journals=new Set<CounterJournal>(),retried=new Set<string>();
    const run=async()=>{
      if(!live||busy)return;busy=true;
      try{
        const waiting=await recoverCounterBacklog({storage:localStorage,currentSeat,active:()=>live,retried,
          sender:counterEvidenceSender,track:j=>{journals.add(j);return()=>journals.delete(j);},
          withSeat:async(seat,work)=>{
            if(navigator.locks)await navigator.locks.request(`bos-counter-tab:${seat}`,{ifAvailable:true},async lock=>{if(lock&&live)await work();});
          }});
        if(live)setNote(waiting?`${waiting} older saved action${waiting===1?'':'s'} still need delivery or marshal review. Open Saved counter evidence.`:null);
      }catch{if(live)setNote('Older saved evidence could not be checked. Keep paper backup and open Saved counter evidence.');}
      finally{busy=false;}
    };
    void run();
    const wake=()=>{if(!document.hidden)void run();};
    const timer=window.setInterval(wake,5000);
    window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
    return()=>{live=false;journals.forEach(j=>j.close());window.clearInterval(timer);window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);};
  },[currentSeat,enabled]);
  return note;
}
