import { describe, expect, it } from 'vitest';
import { classifyRpcError, scoreEventArgs } from './scoreSender';
import { MemoryStorage, Outbox } from './outbox';
import { drainSubject } from './outboxWait';

describe('classifyRpcError', () => {
  it('retries when the network or server fails', () => {
    expect(classifyRpcError({ message: 'TypeError: Failed to fetch', code: '' })).toBe('retry');
    expect(classifyRpcError({ message: 'x' })).toBe('retry');
    expect(classifyRpcError({ code: 'PGRST000', status: 503 })).toBe('retry');
    expect(classifyRpcError({ code: '08006' })).toBe('retry');
    expect(classifyRpcError({ code: 'PGRST301' })).toBe('retry');
    expect(classifyRpcError({ code: '28000' })).toBe('retry');
    for (const code of ['PGRST000', 'PGRST001', 'PGRST002', '40001', '40P01', '55P03', '57014', '53300']) expect(classifyRpcError({ code })).toBe('retry');
  });
  it('retries codes it does not know, so nothing is dropped silently', () => {
    expect(classifyRpcError({ code: 'PGRST999' })).toBe('retry');
    expect(classifyRpcError({ code: 'ZZ123' })).toBe('retry');
  });
  it('uses the response status when given', () => {
    expect(classifyRpcError({ code: 'P0001' }, 503)).toBe('retry');
    expect(classifyRpcError({ code: 'P0001' }, 400)).toBe('reject');
  });
  it('rejects permission and validation errors', () => {
    expect(classifyRpcError({ code: '42501' })).toBe('reject');
    expect(classifyRpcError({ code: 'P0001', message: 'this match is already final' })).toBe('reject');
    expect(classifyRpcError({ code: 'P0002' })).toBe('reject');
    expect(classifyRpcError({ code: '22P02' })).toBe('reject');
    expect(classifyRpcError({ code: '22023' })).toBe('reject');
    expect(classifyRpcError({ code: '23505' })).toBe('reject');
    expect(classifyRpcError({ code: 'PGRST204' })).toBe('reject');
    expect(classifyRpcError({ code: 'PGRST116' })).toBe('reject');
    expect(classifyRpcError({ code: 'PGRST202', status: 404 })).toBe('reject');
  });
});

describe('scoreEventArgs', () => {
  it('uses the entry id as the idempotency key', () => {
    expect(scoreEventArgs({ id: 'e1', kind: 'duel.strike', subject: 'm1', payload: { points: 2 }, createdAt: 0, attempts: 0 }))
      .toEqual({ p_id: 'e1', p_match: 'm1', p_kind: 'duel.strike', p_payload: { points: 2 }, p_client_at: '1970-01-01T00:00:00.000Z' });
  });
});

describe('drainSubject', () => {
  const make = () => { let n = 0; return new Outbox(new MemoryStorage(), () => 1, () => `id${++n}`); };
  const sleep = async () => {};
  it('is clear once the match entries are sent', async () => {
    const box = make();
    await box.enqueue('k', 'm1', 1); await box.enqueue('k', 'm1', 2);
    expect(await drainSubject(box, async () => 'ok', 'm1', { sleep })).toMatchObject({ clear: true, remaining: 0 });
  });
  it('reports not clear when offline', async () => {
    const box = make();
    await box.enqueue('k', 'm1', 1);
    expect(await drainSubject(box, async () => 'retry', 'm1', { sleep })).toMatchObject({ clear: false, remaining: 1 });
  });
  it('collects rejected entries', async () => {
    const box = make();
    await box.enqueue('k', 'm1', 1);
    const r = await drainSubject(box, async () => 'reject', 'm1', { sleep });
    expect(r.clear).toBe(true);
    expect(r.rejected).toHaveLength(1);
  });
});
