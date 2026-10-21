import { describe, expect, it } from 'vitest';
import { countPendingLocalScoring, listKeys, readSavedEvidence, type KeyedStorage } from './localEvidence';

/** A storage that fails the test if any value outside the counter prefixes is read. All data is fictional. */
function storage(entries: Record<string, string>): KeyedStorage & { reads: string[] } {
  const keys = Object.keys(entries);
  const reads: string[] = [];
  return {
    reads,
    get length() { return keys.length; },
    key: i => keys[i] ?? null,
    getItem: k => {
      reads.push(k);
      if (!k.startsWith('bos-counter-journal:v1:') && !k.startsWith('bos-lyst-taps:')) throw new Error(`read a value it must not read: ${k}`);
      return entries[k] ?? null;
    }
  };
}
const tap = (id: string, round = 1, extra: Record<string, unknown> = {}) => ({ kind: 'tap', id, round, weight: 1, ...extra });
const journal = (o: Record<string, unknown>) => JSON.stringify({ version: 1, totals: {}, pending: [], held: [], ...o });
const SECRETS = {
  'sb-fictional-auth-token': '{"access_token":"never-read"}',
  'bos-device-session': 'never-read',
  'unrelated-setting': 'never-read'
};

describe('reading saved counter evidence', () => {
  it('keeps a marshal handoff archive copy without blocking updates or hiding pending taps',()=>{
    const s=storage({'bos-counter-journal:v1:s':journal({held:[{action:tap('archived'),reason:'Access ended',archivedAt:'2026-10-21T04:00:00Z'}],pending:[tap('pending')]})});
    expect(readSavedEvidence(s)[0].items.map(i=>i.status)).toEqual(['pending','held_archived']);
    expect(countPendingLocalScoring(s)).toMatchObject({journalPending:1,heldUndelivered:0,safe:false});
    expect(readSavedEvidence(s)[0].raw).toContain('archived');
  });
  it('labels an already accepted older action as accepted rather than review evidence',()=>{
    const s=storage({'bos-counter-journal:v1:s':journal({held:[{action:tap('accepted'),reason:'Already accepted',delivered:true,alreadyAccepted:true}]})});
    expect(readSavedEvidence(s)[0].items[0].status).toBe('held_accepted');expect(countPendingLocalScoring(s).safe).toBe(true);
  });
  it('lists keys without reading unrelated values (auth, session, settings)', () => {
    const s = storage({ ...SECRETS, 'bos-counter-journal:v1:seat-1': journal({ pending: [tap('t1')] }) });
    const recs = readSavedEvidence(s);
    expect(recs).toHaveLength(1);
    expect(s.reads).toEqual(['bos-counter-journal:v1:seat-1']);
    expect(listKeys(s)).toContain('sb-fictional-auth-token');
    const work = countPendingLocalScoring(s);
    expect(work.journalPending).toBe(1);
    expect(s.reads.every(k => k.startsWith('bos-counter-journal:v1:'))).toBe(true);
  });
  it('ignores probe keys', () => {
    const s = storage({ 'bos-counter-journal:v1:probe': 'x', 'bos-counter-journal:v1:seat-1:probe': 'x', 'bos-timer-intent:v1:probe': 'x' });
    expect(readSavedEvidence(s)).toEqual([]);
    expect(countPendingLocalScoring(s).safe).toBe(true);
    expect(s.reads).toEqual([]);
  });
  it('keeps a corrupt or unknown record as exact raw text, and never calls it safe', () => {
    const s = storage({ 'bos-counter-journal:v1:seat-1': '{not json', 'bos-counter-journal:v1:seat-2': JSON.stringify({ version: 7, items: [] }) });
    const recs = readSavedEvidence(s);
    expect(recs.map(r => [r.readable, r.raw])).toEqual([[false, '{not json'], [false, JSON.stringify({ version: 7, items: [] })]]);
    expect(recs.every(r => r.problem)).toBe(true);
    const w = countPendingLocalScoring(s);
    expect(w.unreadable).toBe(2); expect(w.safe).toBe(false);
  });
  it('keeps an unreadable entry inside a readable journal as raw text and counts it as unknown', () => {
    const s = storage({ 'bos-counter-journal:v1:seat-1': journal({ pending: [tap('t1'), { kind: 'tap', id: 'bad', round: 99, weight: 5 }] }) });
    const [r] = readSavedEvidence(s);
    expect(r.items.map(i => i.status)).toEqual(['pending', 'unreadable']);
    expect(r.items[1].raw).toContain('"round":99');
    expect(countPendingLocalScoring(s)).toMatchObject({ journalPending: 1, unreadable: 1, safe: false });
  });
  it('tells delivered review evidence from held evidence that never reached the server', () => {
    const s = storage({ 'bos-counter-journal:v1:seat-1': journal({
      held: [{ action: tap('d1'), reason: 'Late', delivered: true }, { action: tap('u1'), reason: 'Round changed' }],
      totals: { 'match-x:1': 4, 'match-y:2': 3 }
    }) });
    const [r] = readSavedEvidence(s);
    expect(r.items.map(i => [i.id, i.status, i.reason])).toEqual([['d1', 'held_delivered', 'Late'], ['u1', 'held_undelivered', 'Round changed']]);
    expect(r.accepted).toEqual([{ matchId: 'match-x', round: 1, total: 4 }, { matchId: 'match-y', round: 2, total: 3 }]);
    expect(countPendingLocalScoring(s)).toMatchObject({ heldUndelivered: 1, journalPending: 0, total: 1, safe: false });
  });
  it('reads two seats separately with their fight provenance and optional public labels', () => {
    const s = storage({
      'bos-counter-journal:v1:seat-1': journal({ pending: [tap('a1', 1, { matchId: 'm-1', runId: 'r-1' })], contexts: { 'm-1': { event: 'Northshore Melee (test)', fight: 'Pool A · Fight 3', operator: 'Sam', token: 'ignored' } } }),
      'bos-counter-journal:v1:seat-2': journal({ pending: [tap('b1', 2, { matchId: 'm-2' }), tap('b2', 2, { matchId: 'm-2' })] })
    });
    const recs = readSavedEvidence(s);
    expect(recs.map(r => [r.seatId, r.items.length])).toEqual([['seat-1', 1], ['seat-2', 2]]);
    expect(recs[0].items[0]).toMatchObject({ matchId: 'm-1', runId: 'r-1' });
    expect(recs[0].contexts['m-1']).toEqual({ event: 'Northshore Melee (test)', fight: 'Pool A · Fight 3', operator: 'Sam' });
    expect(countPendingLocalScoring(s).journalPending).toBe(3);
  });
  it('counts an older tap queue only when no journal took it over', () => {
    const legacy = JSON.stringify([tap('l1'), tap('l2')]);
    const alone = storage({ 'bos-lyst-taps:seat-9': legacy });
    expect(countPendingLocalScoring(alone)).toMatchObject({ legacyPending: 2, safe: false });
    const migrated = storage({ 'bos-lyst-taps:seat-9': legacy, 'bos-counter-journal:v1:seat-9': journal({ legacyIds: ['l1', 'l2'] }) });
    const recs = readSavedEvidence(migrated);
    expect(recs.find(r => r.source === 'legacy')).toMatchObject({ superseded: true, raw: legacy });
    expect(countPendingLocalScoring(migrated)).toMatchObject({ legacyPending: 0, safe: true });
    expect(countPendingLocalScoring(storage({ 'bos-lyst-taps:seat-8': 'garbage' }))).toMatchObject({ unreadable: 1, safe: false });
  });
  it('does not hide old-tab taps merely because a newer journal exists', () => {
    const legacy = JSON.stringify([tap('l1'), tap('new-old-tab-tap')]);
    const s = storage({ 'bos-lyst-taps:seat-9': legacy, 'bos-counter-journal:v1:seat-9': journal({ legacyIds: ['l1'] }) });
    expect(readSavedEvidence(s).find(r => r.source === 'legacy')?.superseded).toBe(false);
    expect(countPendingLocalScoring(s)).toMatchObject({ legacyPending: 2, safe: false });
  });
  it('treats a failed storage inventory or invalid total as unknown work', () => {
    const denied: KeyedStorage = { get length():number { throw Error('denied'); }, key: () => null, getItem: () => null };
    expect(countPendingLocalScoring(denied)).toMatchObject({ unreadable: 1, safe: false });
    expect(countPendingLocalScoring(storage({ 'bos-counter-journal:v1:s': journal({ totals: { 'fight:1': -1 } }) })))
      .toMatchObject({ unreadable: 1, safe: false });
  });
  it('counts saved clock intents by key alone, without reading them', () => {
    const s = storage({ 'bos-timer-intent:v1:user-1:match-1': '{"command":{}}', ...SECRETS });
    expect(countPendingLocalScoring(s)).toMatchObject({ timerIntents: 1, total: 1, safe: false });
    expect(s.reads).toEqual([]);
  });
  it('an empty browser has nothing waiting', () => {
    expect(countPendingLocalScoring(storage(SECRETS))).toMatchObject({ total: 0, safe: true });
  });
});
