import { describe, expect, it } from 'vitest';
import { classifyRpcError, isLystKind, lystAnswerOutcome, lystCall, scoreEventArgs, senderOutcome } from './scoreSender';

describe('classifyRpcError', () => {
  it('offline when nothing reached the server or the service is unavailable to us', () => {
    expect(classifyRpcError({ message: 'TypeError: Failed to fetch', code: '' })).toBe('offline');
    expect(classifyRpcError({ message: 'x' })).toBe('offline');
    expect(classifyRpcError({ code: '08006' })).toBe('offline');
    expect(classifyRpcError({ code: 'PGRST301' })).toBe('offline');
    expect(classifyRpcError({ code: '28000' })).toBe('offline');
    for (const code of ['PGRST000', 'PGRST001', 'PGRST002']) expect(classifyRpcError({ code })).toBe('offline');
  });
  it('retry (only that match waits) for server trouble and for codes it does not know, so nothing is dropped silently', () => {
    expect(classifyRpcError({ code: 'PGRST000', status: 503 })).toBe('retry');
    for (const code of ['40001', '40P01', '55P03', '57014', '53300']) expect(classifyRpcError({ code })).toBe('retry');
    expect(classifyRpcError({ code: 'PGRST999' })).toBe('retry');
    expect(classifyRpcError({ code: 'ZZ123' })).toBe('retry');
  });
  it('uses the response status when given', () => {
    expect(classifyRpcError({ code: 'P0001' }, 503)).toBe('retry');
    expect(classifyRpcError({ code: 'P0001' }, 400)).toBe('reject');
  });
  it('rejects permission and validation errors, with the server\'s words', () => {
    expect(classifyRpcError({ code: '42501' })).toBe('reject');
    expect(classifyRpcError({ code: 'P0001', message: 'this match is already final' })).toBe('reject');
    expect(classifyRpcError({ code: 'P0002' })).toBe('reject');
    expect(classifyRpcError({ code: '22P02' })).toBe('reject');
    expect(classifyRpcError({ code: '22023' })).toBe('reject');
    expect(classifyRpcError({ code: '23505' })).toBe('reject');
    expect(classifyRpcError({ code: 'PGRST204' })).toBe('reject');
    expect(classifyRpcError({ code: 'PGRST116' })).toBe('reject');
    expect(classifyRpcError({ code: 'PGRST202', status: 404 })).toBe('reject');
    expect(senderOutcome({ code: 'P0001', message: 'this match is already final' })).toEqual({ result: 'reject', error: 'this match is already final' });
  });
});

describe('scoreEventArgs', () => {
  it('uses the entry id as the idempotency key', () => {
    expect(scoreEventArgs({ id: 'e1', kind: 'duel.strike', subject: 'm1', payload: { points: 2 }, createdAt: 0 }))
      .toEqual({ p_id: 'e1', p_match: 'm1', p_kind: 'duel.strike', p_payload: { points: 2 }, p_client_at: '1970-01-01T00:00:00.000Z' });
  });
});

import { vi } from 'vitest';
describe('realSender', () => {
  it('refuses, and keeps, an entry saved by a newer command schema than this app understands', async () => {
    vi.resetModules();
    vi.doMock('./supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) }, rpc: async () => ({ error: null }) } }));
    const { realSender } = await import('./scoreSender');
    const base = { id: 'e1', kind: 'k', subject: 'm1', eventId: 'ev', userId: 'u1', seq: 1, payload: {}, createdAt: 0, attempts: 0, status: 'pending' as const };
    expect(await realSender({ ...base, schema: 1 })).toBe('ok');
    const r = await realSender({ ...base, schema: 99 });
    expect(r).toMatchObject({ result: 'reject' });
    expect((r as { error: string }).error).toMatch(/newer version/);
    expect(await realSender({ ...base, schema: 1, userId: 'someone-else' })).toBe('offline');
  });
});

describe('lyst actions ride the same outbox', () => {
  it('a confirmed round is sent under the entry id (its command id) with the marshal\'s numbers and nothing else', () => {
    const c = lystCall({ id: 'c1', kind: 'lyst.confirm_round', payload: { matchId: 'm1', round: 2, a: 6, b: 5, expectedRev: 3, recommendedA: 7, recommendedB: 5, reason: null } });
    expect(c).toEqual({ fn: 'lyst_confirm_round', args: { p_command: 'c1', p_match: 'm1', p_round: 2, p_awarded_a: 6, p_awarded_b: 5, p_expected_rev: 3, p_recommended_a: 7, p_recommended_b: 5, p_reason: null } });
  });
  it('discipline and void are mapped the same way', () => {
    expect(lystCall({ id: 'd1', kind: 'lyst.discipline', payload: { matchId: 'm1', round: 1, side: 'a', kind: 'deduction', amount: 1, reason: 'Illegal strike', calledBy: 'Lee' } })?.args)
      .toMatchObject({ p_command: 'd1', p_kind: 'deduction', p_amount: 1, p_side: 'a', p_called_by: 'Lee' });
    expect(lystCall({ id: 'v1', kind: 'lyst.void', payload: { id: 'd1', reason: 'wrong fighter' } })).toEqual({ fn: 'lyst_void_discipline', args: { p_command: 'v1', p_id: 'd1', p_reason: 'wrong fighter' } });
  });
  it('the timer is not an outbox kind: it cannot be changed offline', () => {
    expect(isLystKind('lyst.timer')).toBe(false);
    expect(lystCall({ id: 'x', kind: 'lyst.timer', payload: {} })).toBeNull();
    expect(isLystKind('lyst.confirm_round')).toBe(true);
  });
  it('a stale confirm is kept for review, not dropped and not replayed', () => {
    expect(lystAnswerOutcome({ status: 'stale' })).toMatchObject({ result: 'reject' });
    expect(lystAnswerOutcome({ status: 'ok' })).toBe('ok');
    expect(lystAnswerOutcome({ status: 'duplicate' })).toBe('ok');
    expect(lystAnswerOutcome(null)).toBe('ok');
  });
});
