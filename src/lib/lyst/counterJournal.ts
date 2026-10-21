import type { CountAction, CountContext, CounterSend } from './counters';

export interface HeldCount { action: CountAction; reason: string; delivered?: boolean; alreadyAccepted?:boolean; archivedAt?:string }
export interface CounterLedger {
  version: 1;
  totals: Record<string, number>;
  pending: CountAction[];
  held: HeldCount[];
  weights?: Record<string, number[]>;
  contexts?: Record<string,{event:string;fight:string;field:string}>;
  legacyImported?: boolean;
  legacyIds?: string[];
}
export interface CounterStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const empty = (): CounterLedger => ({ version: 1, totals: {}, pending: [], held: [] });
const actionValid = (a: CountAction) => a && typeof a.id === 'string' && a.id.length > 0 && Number.isInteger(a.round) && a.round >= 1 && a.round <= 20
  && (a.kind === 'undo' || (a.kind === 'tap' && (a.weight === 1 || a.weight === 2)));

/** One durable write contains both the acknowledged total and the remaining
 * command IDs. A crash cannot restore an old total with a new queue. Network
 * retries use the SAME IDs, including when a response was lost after commit.
 * Refused or stale evidence is kept separately for a human, never discarded.
 */
export class CounterJournal {
  private ledger: CounterLedger = empty();
  private flight: Promise<void> | null = null;
  private sequence = 0;
  private scope: string;
  private active=true;
  private epoch=0;
  private unreadableSavedRecord:string|null=null;
  private unreadableLegacyRecord:string|null=null;
  durable = true;
  storageProblem: string | null = null;
  offline = false;
  refusal: string | null = null;
  constructor(readonly seatId: string, private storage: CounterStorage, private notify: () => void = () => {}, private newId = () => crypto.randomUUID()) {
    this.scope = seatId;
    try {
      const raw = storage.getItem(this.key);
      this.unreadableSavedRecord=raw;
      if (raw) {
        const parsed = JSON.parse(raw) as CounterLedger;
        if (parsed.version !== 1 || !Array.isArray(parsed.pending) || !Array.isArray(parsed.held) || !parsed.totals
          || !parsed.pending.every(actionValid) || !parsed.held.every(h => h && actionValid(h.action) && typeof h.reason === 'string')
          || parsed.weights && Object.values(parsed.weights).some(ws => !Array.isArray(ws) || ws.some(w => w!==1 && w!==2))
          || Object.entries(parsed.totals).some(([r, n]) => !/:(?:[1-9]|1[0-9]|20)$/.test(r) || !Number.isInteger(n) || n < 0)) throw new Error('Saved counts could not be read.');
        this.ledger = parsed;
      }
        // Preserve the older queue on upgrade. Its original storage key is
        // deliberately left intact as a recovery copy, never silently removed.
        const legacy = storage.getItem(`bos-lyst-taps:${seatId}`);
        if (legacy) {
          this.unreadableLegacyRecord=legacy;
          const pending: CountAction[] = JSON.parse(legacy);
          if (!Array.isArray(pending) || !pending.every(actionValid)) throw new Error('Older saved counts could not be read.');
          const known=new Set([...(this.ledger.legacyIds??[]),...this.ledger.pending.map(a=>a.id),...this.ledger.held.map(h=>h.action.id)]);
          this.ledger.pending.push(...pending.filter(a=>!known.has(a.id)));
          this.ledger.legacyImported=true;
          this.ledger.legacyIds=[...new Set([...(this.ledger.legacyIds??[]),...pending.map(a=>a.id)])];
          this.unreadableLegacyRecord=null;
        }
      // Probe a separate key. A second tab must not overwrite the live journal
      // just by mounting before it has acquired the counting lock.
      const probe=`bos-counter-probe:${seatId}`;
      try{
        storage.setItem(probe,'1');
        if(storage.getItem(probe)!=='1')throw Error('This browser did not retain saved counts.');
      }catch(e){this.durable=false;this.storageProblem=e instanceof Error?e.message:'This browser cannot save counts.';}
      this.unreadableSavedRecord=null;
    } catch (e) {
      this.durable = false;
      this.storageProblem = e instanceof Error ? e.message : 'Saved counts could not be read.';
      // Do not overwrite unreadable evidence with an empty journal.
      this.corrupt = true;
    }
  }
  private corrupt = false;
  get key() { return `bos-counter-journal:v1:${this.seatId}`; }
  get pending(): readonly CountAction[] { return this.ledger.pending; }
  get held(): readonly HeldCount[] { return this.ledger.held; }
  get sending() { return this.flight !== null; }
  get revision() { return this.sequence; }
  activate(){this.active=true;this.epoch++;}
  close(){this.active=false;this.epoch++;}
  /** A seat can advance to another fight without changing its ID. */
  setScope(matchId: string) { this.scope = matchId; }
  rememberContext(matchId:string,context:{event:string;fight:string;field:string}){
    if(!this.active || JSON.stringify(this.ledger.contexts?.[matchId])===JSON.stringify(context))return;
    (this.ledger.contexts??={})[matchId]=context;this.changed();
  }
  private totalKey(round: number, matchId = this.scope) { return `${matchId}:${round}`; }
  private persist() {
    if (this.corrupt || !this.active) return;
    try {
      const value = JSON.stringify(this.ledger);
      this.storage.setItem(this.key, value);
      if (this.storage.getItem(this.key) !== value) throw new Error('This browser did not retain the saved count.');
      this.durable = true; this.storageProblem = null;
    } catch (e) { this.durable = false; this.storageProblem = e instanceof Error ? e.message : 'This browser cannot save counts.'; }
  }
  private changed() { this.sequence++; this.persist(); if(this.active)this.notify(); }
  total(round: number) { return this.ledger.totals[this.totalKey(round)] ?? 0; }
  confirmedWeights(round: number): readonly number[] { return this.ledger.weights?.[this.totalKey(round)] ?? []; }
  display(round: number, runId?: string) {
    // Provisional offline evidence remains visible as the counter's own number;
    // ordinary refused actions do NOT inflate the tally or stop standing taps.
    const evidence = [...this.ledger.held.filter(h => h.action.recovery).map(h => h.action), ...this.ledger.pending];
    return evidence.filter(a => a.round === round && (a.matchId ?? this.seatId) === this.scope && (!runId || !a.runId || a.runId === runId))
      .reduce((n, a) => a.kind === 'tap' ? n + a.weight : Math.max(0, n - (a.undoWeight ?? 1)), this.total(round));
  }
  undoWeight(round: number, runId?: string) {
    const stack = [...(this.ledger.weights?.[this.totalKey(round)] ?? [])];
    const local = [...this.ledger.held.filter(h => h.action.recovery).map(h => h.action), ...this.ledger.pending];
    for (const a of local.filter(a => a.round === round && (a.matchId ?? this.seatId) === this.scope && (!runId || !a.runId || a.runId === runId))) {
      if (a.kind === 'tap') stack.push(a.weight); else stack.pop();
    }
    return stack.at(-1) ?? 1;
  }
  add(kind: 'tap' | 'undo', round: number, weight = 1, context: CountContext = {}) {
    const action: CountAction = kind === 'tap' ? { ...context, matchId: this.scope, kind, round, weight, id: this.newId() } : { undoWeight: this.undoWeight(round, context.runId), ...context, matchId: this.scope, kind, round, id: this.newId() };
    if (!actionValid(action)) throw new Error('Invalid counter action.');
    this.ledger.pending.push(action); this.refusal = null; this.changed();
    return action;
  }
  /** Snapshot only applies if no send/tap happened since the request began.
   * With pending IDs a server total might already contain a lost-ack tap, so it
   * cannot safely be added to them. The retry response reconciles that ID.
   */
  acceptSnapshot(round: number, total: number, requestedAtRevision: number, weights?: number[]) {
    if (this.sequence !== requestedAtRevision || this.flight || this.ledger.pending.some(a => a.round === round && (a.matchId ?? this.seatId) === this.scope) || !Number.isInteger(total) || total < 0) return false;
    if (weights && (weights.some(w => w!==1 && w!==2) || weights.reduce((n,w)=>n+w,0)!==total)) return false;
    this.ledger.totals[this.totalKey(round)] = total;
    if (weights) (this.ledger.weights ??= {})[this.totalKey(round)] = [...weights];
    this.changed(); return true;
  }
  holdOtherRounds(round: number) {
    const old = this.ledger.pending.filter(a => a.round !== round);
    if (!old.length) return;
    this.ledger.held.push(...old.map(action => ({ action, reason: 'The round changed before delivery. Ask the marshal to review this evidence.' })));
    this.ledger.pending = this.ledger.pending.filter(a => a.round === round); this.changed();
  }
  holdOtherRuns(runId: string) {
    const old = this.ledger.pending.filter(a => a.runId && a.runId !== runId);
    if (!old.length) return;
    this.ledger.held.push(...old.map(action => ({ action, reason: 'The run changed before delivery. Ask the marshal to review this evidence.' })));
    this.ledger.pending = this.ledger.pending.filter(a => !a.runId || a.runId === runId); this.changed();
  }
  retryHeld(ids:ReadonlySet<string>){
    const retry=this.ledger.held.filter(h=>!h.delivered&&!h.archivedAt&&ids.has(h.action.id));
    if(!retry.length)return;
    this.ledger.pending.push(...retry.map(h=>h.action));
    this.ledger.held=this.ledger.held.filter(h=>!retry.includes(h));this.changed();
  }
  archiveShownEvidence(ids:ReadonlySet<string>,includePending=false){
    let changed=false;
    if(includePending){
      const shown=this.ledger.pending.filter(a=>ids.has(a.id));
      this.ledger.held.push(...shown.map(action=>({action,reason:'The phone holder reported a marshal handoff after access ended. Kept locally, not delivered.',archivedAt:new Date().toISOString()})));
      this.ledger.pending=this.ledger.pending.filter(a=>!ids.has(a.id));changed=shown.length>0;
    }
    for(const held of this.ledger.held)if(!held.delivered&&!held.archivedAt&&ids.has(held.action.id)){
      held.archivedAt=new Date().toISOString();changed=true;
    }
    if(changed)this.changed();
    return this.durable;
  }
  /** All callers await the same pump; Done cannot overtake an active send. */
  flush(send: CounterSend): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = this.drain(send).finally(() => { this.flight = null; if(this.active)this.notify(); });
    return this.flight;
  }
  private async drain(send: CounterSend) {
    const epoch=this.epoch;
    while (this.ledger.pending.length && this.active && this.epoch===epoch) {
      const head = this.ledger.pending[0];
      let answer: Awaited<ReturnType<CounterSend>>;
      try { answer = await send(head); } catch { this.offline = true; if(this.active)this.notify(); return; }
      if(!this.active || this.epoch!==epoch)return;
      if (answer.status === 'offline') { this.offline = true; this.notify(); return; }
      this.offline = false;
      // The round may have changed while this request was in flight. Locate the
      // exact command; never remove another command or update another round.
      const index = this.ledger.pending.findIndex(a => a.id === head.id);
      if (index < 0) return;
      if (answer.status === 'review') {
        this.ledger.held.push({ action: head, reason: answer.message, delivered: true,...(answer.alreadyAccepted?{alreadyAccepted:true}:{}) });
        this.ledger.pending.splice(index, 1); this.changed(); continue;
      }
      if (answer.status === 'refused') {
        this.refusal = answer.message;
        if (answer.reason === 'ROUND_NOT_STARTED') { this.notify(); return; }
        this.ledger.held.push({ action: head, reason: answer.message || 'Server refused this count; marshal review needed.' });
        this.ledger.pending.splice(index, 1); this.changed();
        // Preserve subsequent actions in order for later review as well.
        continue;
      }
      const key = this.totalKey(head.round, head.matchId ?? this.seatId);
      this.ledger.totals[key] = answer.total;
      const stack = (this.ledger.weights ??= {})[key] ??= [];
      if (head.kind === 'tap') stack.push(head.weight); else stack.pop();
      if (answer.weights && answer.weights.every(w=>w===1 || w===2) && answer.weights.reduce((n,w)=>n+w,0)===answer.total) this.ledger.weights![key]=[...answer.weights];
      this.ledger.pending.splice(index, 1); this.changed();
    }
    this.notify();
  }
  /** Copyable evidence stays bound to this exact seat/fight; no official score. */
  export() { return JSON.stringify({ seatId: this.seatId, ...this.ledger,...(this.unreadableSavedRecord?{unreadableSavedRecord:this.unreadableSavedRecord}:{}),...(this.unreadableLegacyRecord?{unreadableLegacyRecord:this.unreadableLegacyRecord}:{}) }, null, 2); }
}
