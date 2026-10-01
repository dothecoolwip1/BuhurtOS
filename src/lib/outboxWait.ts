import type { FlushReport, Outbox, OutboxEntry, Sender } from './outbox';

export interface DrainResult { clear: boolean; remaining: number; rejected: OutboxEntry[] }

/**
 * Flush until nothing is waiting for one subject (a match), or give up. Needed before finalising: the result must not
 * be saved while some of its score events are still on the device. Outbox.flush returns at once if a flush is already
 * running, so this polls until that one finishes too.
 */
export async function drainSubject(box: Outbox, send: Sender, subject: string, opts: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<DrainResult> {
  const { timeoutMs = 15000, pollMs = 300, sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)) } = opts;
  const rejected: OutboxEntry[] = [];
  let waited = 0;
  for (;;) {
    const report: FlushReport = await box.flush(send);
    rejected.push(...report.rejected);
    const remaining = (await box.pending()).filter(e => e.subject === subject).length;
    if (remaining === 0) return { clear: true, remaining: 0, rejected };
    if (report.stoppedOffline || waited >= timeoutMs) return { clear: false, remaining, rejected };
    await sleep(pollMs);
    waited += pollMs;
  }
}
