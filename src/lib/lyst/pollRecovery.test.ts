import { describe, expect, it } from 'vitest';
import { POLL_BACKOFF_CAP_MS, isExpiredSignIn, pollBackoffMs, sendWithRetry, sessionRefresher } from './pollRecovery';
import { isNoSignalError } from '../fieldScoring';

describe('Lyst reads after a failure (seven-profile rehearsal)', () => {
  it('no wait while reads succeed; then 2.5 s, 5 s, 10 s, capped at 10 s, with ±20% jitter', () => {
    const mid = () => 0.5;
    expect(pollBackoffMs(0, 2500, mid)).toBe(0);
    expect([1, 2, 3, 4, 9].map(n => pollBackoffMs(n, 2500, mid))).toEqual([2500, 5000, 10000, 10000, 10000]);
    expect(pollBackoffMs(9, 2500, () => 0.999)).toBeLessThanOrEqual(POLL_BACKOFF_CAP_MS * 1.2);
    expect(pollBackoffMs(1, 2500, () => 0)).toBe(2000);
  });
  it('an expired sign-in is told apart from no signal', () => {
    expect(isExpiredSignIn({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    expect(isExpiredSignIn({ code: 'PGRST303' })).toBe(true);
    expect(isExpiredSignIn({ status: 401 })).toBe(true);
    expect(isExpiredSignIn({ code: '28000', message: 'sign in required' })).toBe(true);
    expect(isExpiredSignIn({ message: 'TypeError: Failed to fetch' })).toBe(false);
    expect(isExpiredSignIn({ status: 503 })).toBe(false);
    expect(isExpiredSignIn(null)).toBe(false);
  });
  it('the session is refreshed once at a time and not more than every 20 s', async () => {
    let t = 0; let calls = 0;
    const go = sessionRefresher(async () => { calls++; }, 20_000, () => t);
    const [a, b] = [go(), go()];
    expect(await a).toBe(true); expect(await b).toBe(true); expect(calls).toBe(1);
    t = 5_000; expect(await go()).toBe(false); expect(calls).toBe(1);
    t = 25_000; expect(await go()).toBe(true); expect(calls).toBe(2);
  });
  it('a failed refresh says so and does not throw', async () => {
    const go = sessionRefresher(async () => { throw new Error('503'); }, 0, () => 0);
    expect(await go()).toBe(false);
  });
});

describe('a paper sheet whose answer never came is sent again with the same id', () => {
  const noWait = async () => undefined;
  it('a 503 and an abandoned request are tried again, with the same arguments, until one answers', async () => {
    const seen: string[] = []; let n = 0;
    const r = await sendWithRetry(async () => { seen.push('sheet-1'); n++; if (n === 1) throw { status: 503, message: 'Service Unavailable' }; if (n === 2) throw { code: '', message: 'AbortError: signal is aborted without reason' }; return 'ok'; }, isNoSignalError, [1000, 3000], noWait);
    expect(r).toBe('ok'); expect(seen).toEqual(['sheet-1', 'sheet-1', 'sheet-1']);
  });
  it('a refusal from the server is not retried', async () => {
    let n = 0;
    await expect(sendWithRetry(async () => { n++; throw { code: 'P0001', message: 'Anna already has a sheet for round 2' }; }, isNoSignalError, [1000, 3000], noWait)).rejects.toMatchObject({ code: 'P0001' });
    expect(n).toBe(1);
  });
  it('gives up after the last delay and passes the failure on', async () => {
    let n = 0;
    await expect(sendWithRetry(async () => { n++; throw { status: 500 }; }, isNoSignalError, [1, 1], noWait)).rejects.toMatchObject({ status: 500 });
    expect(n).toBe(3);
  });
  it('the app giving up waiting counts as no answer (the server may still have saved it)', () => {
    expect(isNoSignalError({ code: '', message: 'AbortError: signal is aborted without reason' })).toBe(true);
    expect(isNoSignalError({ code: 'P0001', message: 'refused' })).toBe(false);
  });
});
