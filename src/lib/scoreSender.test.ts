import { describe, expect, it } from 'vitest';
import { classifyRpcError, scoreEventArgs, senderOutcome } from './scoreSender';

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
