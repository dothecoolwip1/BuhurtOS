import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { IdbOutboxStorage, LEGACY_USER, MemoryStorage, Outbox, STUCK_ATTEMPTS, importLegacyOutbox, type OutboxEntry, type OutboxStorage, type Sender } from './outbox';
import { openScoringDb } from './idb';
import { drainSubject } from './outboxWait';

let n = 0;
const A = { userId: 'user-a', eventId: 'ev-1' };
const B = { userId: 'user-b', eventId: 'ev-1' };
const make = (storage: OutboxStorage = new MemoryStorage()) => new Outbox(storage, () => 1000, () => `id-${++n}`);
/** A fresh IndexedDB the way a browser reload sees it: the same database, a brand new Outbox object. */
const freshIdb = () => new IDBFactory();
const idbStorage = (f: IDBFactory) => new IdbOutboxStorage(openScoringDb(f));
const sendAll: Sender = async () => 'ok';

describe('1. cross-user isolation', () => {
  it('user B signing in on the same device cannot flush user A\'s work', async () => {
    const f = freshIdb();
    await make(idbStorage(f)).enqueue(A, 'point', 'm1', { by: 'A' });
    const boxB = make(idbStorage(f));        // reload as B
    const seen: string[] = [];
    const r = await boxB.flush(async e => { seen.push(e.userId); return 'ok'; }, B.userId);
    expect(seen).toEqual([]);
    expect(r).toMatchObject({ sent: 0, remaining: 0, heldForOthers: 1 });
    expect(await boxB.all()).toHaveLength(1);     // still there, untouched
    const rA = await make(idbStorage(f)).flush(async e => { seen.push(e.userId); return 'ok'; }, A.userId);
    expect(seen).toEqual(['user-a']);
    expect(rA.sent).toBe(1);
  });
  it('every entry records its user, event, schema version, order and idempotency id', async () => {
    const box = make();
    const e = await box.enqueue(A, 'duel.strike', 'm1', { points: 2 });
    expect(e).toMatchObject({ userId: 'user-a', eventId: 'ev-1', subject: 'm1', kind: 'duel.strike', schema: 1, seq: 1, status: 'pending', attempts: 0, createdAt: 1000 });
    expect(e.id).toMatch(/^id-/);
    expect((await box.enqueue(A, 'duel.strike', 'm1', {})).seq).toBe(2);
  });
  it('refuses to queue work with no signed-in user', async () => {
    await expect(make().enqueue({ userId: '', eventId: 'ev-1' }, 'k', 'm1', 1)).rejects.toThrow(/sign in/);
  });
});

describe('2. a failing entry does not freeze unrelated matches', () => {
  it('a permanent server problem on match 1 does not stop match 2, and match 1 stays queued in order', async () => {
    const box = make();
    await box.enqueue(A, 'point', 'm1', 1); await box.enqueue(A, 'point', 'm1', 2); await box.enqueue(A, 'point', 'm2', 3);
    const sent: string[] = [];
    for (let i = 0; i < 5; i++) {
      await box.flush(async e => { if (e.subject === 'm1') return 'retry'; sent.push(`${e.subject}:${e.payload}`); return 'ok'; }, A.userId);
    }
    expect(sent).toEqual(['m2:3']);
    expect((await box.pending(A.userId)).map(e => `${e.subject}:${e.payload}`)).toEqual(['m1:1', 'm1:2']);   // order inside m1 preserved
  });
  it('a refused entry is marked rejected and the rest of the queue carries on', async () => {
    const box = make();
    await box.enqueue(A, 'point', 'm1', 1); await box.enqueue(A, 'point', 'm2', 2); await box.enqueue(A, 'point', 'm1', 3);
    const r = await box.flush(async e => (e.payload === 1 ? { result: 'reject', error: 'this match is already final' } : 'ok'), A.userId);
    expect(r).toMatchObject({ sent: 2, remaining: 0 });
    expect(r.rejected.map(e => e.payload)).toEqual([1]);
  });
  it('no signal stops the whole run and loses nothing', async () => {
    const box = make();
    await box.enqueue(A, 'a', 'm1', 1); await box.enqueue(A, 'b', 'm2', 2);
    const r = await box.flush(async () => 'offline', A.userId);
    expect(r).toMatchObject({ sent: 0, remaining: 2, stoppedOffline: true });
  });
  it('a thrown error is treated as no signal, not as lost data', async () => {
    const box = make();
    await box.enqueue(A, 'a', 'm1', 1);
    const r = await box.flush(async () => { throw new Error('network'); }, A.userId);
    expect(r).toMatchObject({ sent: 0, remaining: 1, stoppedOffline: true });
  });
  it('counts entries that keep failing as stuck, without dropping them', async () => {
    const box = make();
    await box.enqueue(A, 'a', 'm1', 1);
    for (let i = 0; i < STUCK_ATTEMPTS; i++) await box.flush(async () => 'retry', A.userId);
    expect(box.stuck(A.userId)).toBe(1);
    expect(box.waiting(A.userId)).toBe(1);
  });
});

describe('3. a rejected entry survives a reload and stays reviewable', () => {
  it('is kept in IndexedDB with its reason after the page is reloaded', async () => {
    const f = freshIdb();
    const box = make(idbStorage(f));
    await box.enqueue(A, 'point', 'm1', { x: 1 });
    await box.flush(async () => ({ result: 'reject', error: 'you cannot score this event' }), A.userId);
    expect(await box.pending(A.userId)).toHaveLength(0);
    const reloaded = make(idbStorage(f));
    const kept = await reloaded.rejected(A.userId);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ status: 'rejected', error: 'you cannot score this event', subject: 'm1', payload: { x: 1 } });
    // only an explicit action removes it; another account cannot discard it
    expect(await reloaded.discard(kept[0].id, B.userId)).toBe(false);
    expect(await reloaded.discard(kept[0].id, A.userId)).toBe(true);
    expect(await make(idbStorage(f)).all()).toHaveLength(0);
  });
  it('can be put back in the queue and sent', async () => {
    const box = make();
    const e = await box.enqueue(A, 'point', 'm1', 1);
    await box.flush(async () => 'reject', A.userId);
    expect(await box.retry(e.id, A.userId)).toBe(true);
    const r = await box.flush(sendAll, A.userId);
    expect(r.sent).toBe(1);
  });
});

describe('4+5. a short loss of signal keeps the work and sends it once, in order, on reconnect', () => {
  it('queued work survives the signal loss and a reload, then is delivered exactly once', async () => {
    const f = freshIdb();
    const box = make(idbStorage(f));
    await box.enqueue(A, 'a', 'm1', 1); await box.enqueue(A, 'b', 'm1', 2); await box.enqueue(A, 'c', 'm1', 3);
    await box.flush(async () => 'offline', A.userId);                       // signal lost
    const reloaded = make(idbStorage(f));                                    // tab reloaded while offline
    expect(await reloaded.pending(A.userId)).toHaveLength(3);
    const delivered: string[] = [];
    const r = await reloaded.flush(async e => { delivered.push(`${e.kind}:${e.id}`); return 'ok'; }, A.userId);   // signal back
    expect(r).toMatchObject({ sent: 3, remaining: 0 });
    expect(delivered.map(d => d.split(':')[0])).toEqual(['a', 'b', 'c']);
    const again = await reloaded.flush(async e => { delivered.push(e.id); return 'ok'; }, A.userId);
    expect(again.sent).toBe(0);
    expect(delivered).toHaveLength(3);                                      // nothing sent twice
  });
  it('a delivery that succeeded but whose reply was lost is re-sent with the SAME id (the server de-duplicates)', async () => {
    const box = make();
    const e = await box.enqueue(A, 'point', 'm1', 1);
    const ids: string[] = [];
    await box.flush(async x => { ids.push(x.id); return 'offline'; }, A.userId);   // reply lost, looks like no signal
    await box.flush(async x => { ids.push(x.id); return 'ok'; }, A.userId);
    expect(ids).toEqual([e.id, e.id]);
  });
});

describe('legacy localStorage queue', () => {
  it('is moved into the new store as refused entries, never replayed', async () => {
    const fake: Record<string, string> = { 'bos-outbox-v1': JSON.stringify([{ id: 'old-1', kind: 'point', subject: 'm9', payload: { y: 2 }, createdAt: 5, attempts: 3 }]) };
    const ls = { getItem: (k: string) => fake[k] ?? null, removeItem: (k: string) => { delete fake[k]; } } as unknown as Storage;
    const storage = new MemoryStorage();
    expect(await importLegacyOutbox(storage, () => 9, ls)).toBe(1);
    expect(fake['bos-outbox-v1']).toBeUndefined();
    const box = make(storage);
    const r = await box.flush(async () => 'ok', A.userId);
    expect(r.sent).toBe(0);
    expect((await box.rejected(A.userId))[0]).toMatchObject({ id: 'old-1', userId: LEGACY_USER, status: 'rejected', subject: 'm9' });
    expect(await box.discard('old-1', B.userId)).toBe(true);   // anyone signed in may clear an unowned legacy entry
  });
});

describe('drainSubject', () => {
  const sleep = async () => {};
  it('is clear once the match entries are sent', async () => {
    const box = make();
    await box.enqueue(A, 'k', 'm1', 1); await box.enqueue(A, 'k', 'm1', 2);
    expect(await drainSubject(box, sendAll, A.userId, 'm1', { sleep })).toMatchObject({ clear: true, remaining: 0 });
  });
  it('reports not clear when offline (finalization then stays pending)', async () => {
    const box = make();
    await box.enqueue(A, 'k', 'm1', 1);
    expect(await drainSubject(box, async () => 'offline', A.userId, 'm1', { sleep })).toMatchObject({ clear: false, remaining: 1 });
  });
  it('reports not clear when this match is blocked by server trouble, without waiting for the timeout', async () => {
    const box = make();
    await box.enqueue(A, 'k', 'm1', 1);
    expect(await drainSubject(box, async () => 'retry', A.userId, 'm1', { sleep })).toMatchObject({ clear: false, remaining: 1 });
  });
  it('collects rejected entries', async () => {
    const box = make();
    await box.enqueue(A, 'k', 'm1', 1);
    const r = await drainSubject(box, async () => 'reject', A.userId, 'm1', { sleep });
    expect(r.clear).toBe(true);
    expect(r.rejected as OutboxEntry[]).toHaveLength(1);
  });
});
