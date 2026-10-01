import { describe, expect, it } from 'vitest';
import { MemoryStorage, Outbox, type OutboxEntry } from './outbox';

let n = 0;
const make = (storage = new MemoryStorage()) => new Outbox(storage, () => 1000, () => `id-${++n}`);

describe('Outbox', () => {
  it('saves to storage before anything is sent', async () => {
    const storage = new MemoryStorage();
    const box = make(storage);
    await box.enqueue('score', 'm1', { a: 2 });
    expect(storage.data).toHaveLength(1);
    expect(storage.data[0]).toMatchObject({ kind: 'score', subject: 'm1', attempts: 0 });
  });

  it('survives a reload: a new Outbox reads what was queued', async () => {
    const storage = new MemoryStorage();
    await make(storage).enqueue('score', 'm1', 1);
    const again = make(storage);
    expect(await again.pending()).toHaveLength(1);
  });

  it('sends in order and empties the queue', async () => {
    const box = make();
    await box.enqueue('a', 'm1', 1); await box.enqueue('b', 'm1', 2); await box.enqueue('c', 'm1', 3);
    const order: string[] = [];
    const r = await box.flush(async e => { order.push(e.kind); return 'ok'; });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(r).toMatchObject({ sent: 3, remaining: 0, stoppedOffline: false });
  });

  it('stops at the first retry and keeps order and the rest', async () => {
    const box = make();
    await box.enqueue('a', 'm1', 1); await box.enqueue('b', 'm1', 2); await box.enqueue('c', 'm1', 3);
    let calls = 0;
    const r = await box.flush(async () => (++calls === 2 ? 'retry' : 'ok'));
    expect(r).toMatchObject({ sent: 1, remaining: 2, stoppedOffline: true });
    expect((await box.pending()).map(e => e.kind)).toEqual(['b', 'c']);
  });

  it('treats a thrown error as offline, not as lost data', async () => {
    const box = make();
    await box.enqueue('a', 'm1', 1);
    const r = await box.flush(async () => { throw new Error('network'); });
    expect(r).toMatchObject({ sent: 0, remaining: 1, stoppedOffline: true });
  });

  it('reports a permanent rejection instead of dropping it silently', async () => {
    const box = make();
    await box.enqueue('a', 'm1', 1); await box.enqueue('b', 'm2', 2);
    const r = await box.flush(async (e: OutboxEntry) => (e.subject === 'm1' ? 'reject' : 'ok'));
    expect(r.rejected.map(e => e.kind)).toEqual(['a']);
    expect(r).toMatchObject({ sent: 1, remaining: 0 });
  });

  it('gives each entry its own idempotency id', async () => {
    const box = make();
    const a = await box.enqueue('a', 'm1', 1); const b = await box.enqueue('a', 'm1', 1);
    expect(a.id).not.toBe(b.id);
  });
});
