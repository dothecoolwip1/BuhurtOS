import { beforeEach, describe, expect, it, vi } from 'vitest';

// A recording stand-in for the Supabase query builder: every call is kept so the test can read exactly what was asked of PostgREST.
const calls: Array<{ table: string; select: string; filters: Array<[string, string, unknown]> }> = [];
const answers: Record<string, unknown[]> = {};
const builder = (table: string, select: string) => {
  const rec = { table, select, filters: [] as Array<[string, string, unknown]> };
  calls.push(rec);
  const b: Record<string, unknown> = {
    eq: (c: string, v: unknown) => { rec.filters.push(['eq', c, v]); return b; },
    in: (c: string, v: unknown) => { rec.filters.push(['in', c, v]); return b; },
    then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: answers[table] ?? [], error: null }).then(ok)
  };
  return b;
};
vi.mock('../lib/supabase', () => ({
  supabase: { from: (table: string) => ({ select: (s: string) => builder(table, s) }), rpc: async () => ({ data: [], error: null }) }
}));
import { fetchMyTeamRosters } from './teams';

beforeEach(() => { calls.length = 0; for (const k of Object.keys(answers)) delete answers[k]; });

describe('fetchMyTeamRosters asks PostgREST for an unambiguous relationship', () => {
  it('names the entries -> competitions foreign key (without it PostgREST answers 300 / PGRST201 on the hosted database)', async () => {
    answers.team_roles = [{ team_id: 'ab', teams: { name: 'Ankle Biters' } }];
    await fetchMyTeamRosters('event-1');
    const q = calls.find(c => c.table === 'entries');
    expect(q?.select).toBe('team_id,competitions!entries_competition_id_fkey!inner(event_id)');
    // The embedded competition is still what is filtered, so another event's entries never count as registered.
    expect(q?.filters).toEqual([['eq', 'competitions.event_id', 'event-1'], ['in', 'team_id', ['ab']]]);
  });
  it('does not ask about entries at all when the person captains no team', async () => {
    answers.team_roles = [];
    expect(await fetchMyTeamRosters('event-1')).toEqual([]);
    expect(calls.some(c => c.table === 'entries')).toBe(false);
  });
});

describe('every entries -> competitions embed in the app names its relationship', () => {
  it('has no un-hinted competitions embed on entries', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('.', import.meta.url).pathname;
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter(n => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const text = readFileSync(dir + f, 'utf8');
      // select strings of the form from('entries').select('... competitions(...) / competitions!inner(...) ...') without the foreign key name
      for (const m of text.matchAll(/from\('entries'\)\.select\(([^)]*?)\)/g)) {
        if (/competitions(!inner)?\(/.test(m[1]) && !/entries_competition_id_fkey/.test(m[1])) bad.push(`${f}: ${m[1].slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
