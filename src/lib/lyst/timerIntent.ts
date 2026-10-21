import type { TimerCommand } from '../../data/lyst';
export interface TimerIntent { command: TimerCommand; savedAt: number }
interface Store { getItem(key:string):string|null; setItem(key:string,value:string):void; removeItem(key:string):void }
export function definiteTimerRefusal(error:unknown):'preparation'|'refused'|null{
  const e=error as {code?:string;message?:string}|null;
  if(!e||!['P0001','P0002','42501','22023'].includes(e.code??''))return null;
  return e.message?.includes('COUNTERS_NOT_PREPARED')?'preparation':'refused';
}

/** An uncertain clock command is retained and retried under the same ID. Never
 * auto-drain it on reconnect: a late start needs the marshal's intervention. */
export class TimerIntentStore {
  readonly key: string;
  private memory: TimerIntent|null=null;
  problem: string|null=null;
  unreadableRaw: string|null=null;
  requiresCheck=false;
  private memoryOnly=false;
  constructor(private storage:Store,user:string,private match:string){
    this.key=`bos-timer-intent:v1:${user}:${match}`;
    try {
      const raw=storage.getItem(this.key);
      this.unreadableRaw=raw;
      if(raw){
        const value=JSON.parse(raw) as TimerIntent;
        if(value.command?.matchId!==match || !value.command.command || !Number.isFinite(value.savedAt) || !value.command.requestedAt) throw Error('Saved clock action could not be read.');
        this.memory=value;
      }
      this.unreadableRaw=null;
    } catch { this.requiresCheck=true;this.problem='This browser could not read the saved clock action. Check the clock with the marshal before starting another.'; }
  }
  continueAfterClockCheck(){
    if(!this.requiresCheck)return;
    this.requiresCheck=false;this.memoryOnly=true;
    this.problem='Continuing in memory only after checking the clock. Keep paper time; the original saved action has been preserved.';
  }
  read(){return this.memory;}
  save(value:TimerIntent){
    if(value.command.matchId!==this.match) throw Error('Clock action belongs to another fight.');
    if(this.memory && this.memory.command.command!==value.command.command) throw Error('Resolve the pending clock action first.');
    if(this.requiresCheck) throw Error(this.problem??'Check the saved clock action first.');
    this.memory=value;
    if(this.memoryOnly)return false;
    try{
      const text=JSON.stringify(value); this.storage.setItem(this.key,text);
      if(this.storage.getItem(this.key)!==text) throw Error('write not retained');
      this.problem=null;return true;
    }catch{this.problem='Clock action is in memory only. Check the clock before leaving or reloading this screen.';return false;}
  }
  clear(){
    if(this.requiresCheck)return false;
    if(this.memoryOnly){this.memory=null;return true;}
    try { this.storage.removeItem(this.key); }
    catch { this.memory=null;this.memoryOnly=true;this.problem='The resolved clock action could not be cleared from storage. Continuing in memory only; keep paper time and check again after any reload.'; return true; }
    this.memory=null;this.problem=null;return true;
  }
}
