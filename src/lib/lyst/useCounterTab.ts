import { useEffect,useState } from 'react';

/** A physical phone counts in one tab at a time. Other tabs may show state but
 * cannot rewrite its journal, acknowledge a start, submit Done or send taps. */
export function useCounterTab(seatId:string){
  const [attempt,setAttempt]=useState(0);
  const [manual,setManual]=useState(false);
  const [state,setState]=useState<{status:'checking'|'owned'|'blocked'|'unsupported';token:string}>({status:'checking',token:''});
  useEffect(()=>{
    let live=true,release:(()=>void)|undefined;
    setManual(false);setState({status:'checking',token:''});
    if(!navigator.locks){setState({status:'unsupported',token:''});return;}
    const controller=new AbortController();
    const waiting=window.setTimeout(()=>{if(live)setState({status:'blocked',token:''});},250);
    // Queue ownership instead of failing an ifAvailable request during React's
    // cleanup/remount race. A waiting tab remains disabled until the old owner
    // has released the lock, then reads the latest journal from disk.
    void navigator.locks.request(`bos-counter-tab:${seatId}`,{signal:controller.signal},async lock=>{
      if(!live)return;
      window.clearTimeout(waiting);
      if(!lock){setState({status:'blocked',token:''});return;}
      setState({status:'owned',token:crypto.randomUUID()});
      await new Promise<void>(resolve=>{release=resolve;if(!live)resolve();});
    }).catch(()=>{if(live)setState({status:'unsupported',token:''});});
    return()=>{live=false;window.clearTimeout(waiting);controller.abort();release?.();};
  },[seatId,attempt]);
  return{...state,owned:state.status==='owned'||state.status==='unsupported'&&manual,
    retry:()=>setAttempt(n=>n+1),acknowledgeSingleTab:()=>setManual(true)};
}
