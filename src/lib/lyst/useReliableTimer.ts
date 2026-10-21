import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { timerCommand } from '../../data/lyst';
import type { useLystState } from './useLystState';
import type { TimerSend } from '../../components/lyst/TimerBar';
import { definiteTimerRefusal,TimerIntentStore,type TimerIntent } from './timerIntent';
import { friendlyError } from '../friendlyError';
import { isNoSignalError } from '../fieldScoring';

export function useReliableTimer({lyst,eventId,fieldName,matchId,userKey}:{lyst:ReturnType<typeof useLystState>;eventId:string;fieldName:string;matchId:string;userKey:string}){
  const st=lyst.state;
  const [timerBusy,setTimerBusy]=useState(false);
  const [timerNote,setTimerNote]=useState<string|null>(null);
  const timerStore = useMemo(() => new TimerIntentStore({
    getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)
  },userKey,matchId),[userKey,matchId]);
  const [pendingTimer,setPendingTimer] = useState<TimerIntent|null>(null);
  type TimerOptions = NonNullable<Parameters<TimerSend>[1]>;
  const [clockOverride,setClockOverride] = useState<{action:Parameters<TimerSend>[0];options:TimerOptions}|null>(null);
  const [clockReason,setClockReason] = useState('');
  const [restoreRound,setRestoreRound] = useState<number|null>(null);
  const [restoreSeconds,setRestoreSeconds] = useState('60');
  const timerSending = useRef<string|null>(null);
  const scope=`${userKey}:${matchId}`;
  const activeContext = useRef(scope); activeContext.current=scope;
  useEffect(()=>{timerSending.current=null;setTimerBusy(false);setPendingTimer(timerStore.read());setClockOverride(null);setRestoreRound(null);if(timerStore.problem)setTimerNote(timerStore.problem);},[timerStore]);
  const executeTimer = useCallback(async (intent:TimerIntent) => {
    if(timerSending.current)return;
    timerSending.current=intent.command.command;
    setTimerBusy(true); setTimerNote(null);
    try {
        const {answer,sentAt,receivedAt}=await timerCommand(intent.command);
        if(activeContext.current!==scope)return;
        if (answer.status === 'stale') setTimerNote('Another device changed the clock. Showing the latest. Press again if you still want to.');
        if(answer.status==='expired'){
          setTimerNote('That clock action was too old to start safely. It did not change the clock. Check with the marshal and enter the time remaining if the round is already underway.');
          if(intent.command.action==='start' && intent.command.mode==='fight')setRestoreRound(intent.command.round??1);
        }
        if(timerStore.clear())setPendingTimer(null); else setTimerNote(timerStore.problem);
        lyst.applyTimer(answer.timer, answer.server_now, sentAt, receivedAt);
    } catch(e) {
        if(activeContext.current!==scope)return;
        const refusal=definiteTimerRefusal(e);
        if(refusal){
          if(timerStore.clear())setPendingTimer(null);
          if(refusal==='preparation'){
            const c=intent.command;
            setClockOverride({action:c.action,options:{mode:c.mode??undefined,durationMs:c.durationMs??undefined,round:c.round??undefined,deltaMs:c.deltaMs??0}});
            setClockReason('');setTimerNote('The start was refused because some phones were not prepared. Check them or record the marshal’s paper/offline reason.');
          }else setTimerNote(`${friendlyError(e,'The server refused this request.')} An earlier attempt may already have applied. Check the displayed clock with the marshal before sending another action.`);
          void lyst.refresh();return;
        }
        setTimerNote(isNoSignalError(e) ? 'Clock action not confirmed. It may have reached the server. Check the clock, then retry this same action.' : friendlyError(e,'Clock action not confirmed. Check the clock before retrying.'));
        void lyst.refresh();
    } finally { if(activeContext.current===scope && timerSending.current===intent.command.command){timerSending.current=null;setTimerBusy(false);} }
  },[timerStore,lyst,scope]);
  const sendTimer: TimerSend = useCallback((action,o={})=>{
    if(!st || timerSending.current)return;
    if(timerStore.read()) {setPendingTimer(timerStore.read());setTimerNote('Resolve the unconfirmed clock action before sending another.');return;}
    const mode=o.mode??st.timer?.mode??'fight',n=o.round??st.timer?.round_no??1;
    const missing=st.seats.some(s=>s.status==='active' && s.role==='official'
      && !st.counter_delivery?.some(c=>c.seat_id===s.id && c.round===n && !!c.prepared_at));
    if(action==='start' && mode==='fight' && missing && (o.overrideReason?.trim().length??0)<3){
      setClockOverride({action,options:o});setClockReason('');return;
    }
    const intent:TimerIntent={savedAt:Date.now(),command:{eventId,field:fieldName,matchId:matchId,expectedRev:st.timer?.rev??0,
      command:crypto.randomUUID(),action,mode:o.mode??null,durationMs:o.durationMs??null,round:o.round??null,deltaMs:o.deltaMs??0,
      overrideReason:o.overrideReason??null,requestedAt:new Date(lyst.clock.now(Date.now())).toISOString()}};
    try {
      const durable=timerStore.save(intent);setPendingTimer(intent);
      if(!durable)setTimerNote(timerStore.problem);
      void executeTimer(intent);
    }catch(e){setTimerNote(friendlyError(e));}
  },[st,timerStore,eventId,fieldName,matchId,lyst.clock,executeTimer]);

  const clearPending=()=>{if(timerStore.clear()){setPendingTimer(null);setTimerNote('Saved action cleared after checking the clock.');}};
  const continueAfterClockCheck=()=>{timerStore.continueAfterClockCheck();setTimerNote(timerStore.problem);};
  return {timerBusy,timerNote,pendingTimer,clockOverride,setClockOverride,clockReason,setClockReason,restoreRound,setRestoreRound,restoreSeconds,setRestoreSeconds,sendTimer,executeTimer,clearPending,storageProblem:timerStore.problem,offline:lyst.offline,requiresClockCheck:timerStore.requiresCheck,unreadableClockAction:timerStore.unreadableRaw,continueAfterClockCheck};
}
