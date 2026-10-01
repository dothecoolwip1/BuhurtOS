import { describe, expect, it } from 'vitest';
import { parseRoster } from './roster';
import { buildWorld, registrations } from './world';
import { generate } from './generate';
import { SIDE_SIZE } from './roster';

const { teams, fighters } = parseRoster();
const world = buildWorld();

describe('NACL-test roster', () => {
  it('reads 10 teams and 120 fighters (70 men, 50 women), 12 per team', () => {
    expect(teams).toHaveLength(10);
    expect(fighters).toHaveLength(120);
    expect(fighters.filter(f => f.sex === 'male')).toHaveLength(70);
    for (const t of teams) expect(fighters.filter(f => f.teamIdx === t.idx)).toHaveLength(12);
    expect(new Set(fighters.map(f => f.name)).size).toBe(120);
    expect(fighters.every(f => f.name.endsWith('-test'))).toBe(true);
  });
  it('keeps the owner facts: Gunnar Reed-test has an assumed join year, Finn Mercer-test joins in late 2024, birth year = 2026 - age', () => {
    const g = fighters.find(f => f.name === 'Gunnar Reed-test')!;
    expect(g.joinedAssumed).toBe(true);
    expect(g.joinedYear).toBe(2019);
    expect(fighters.find(f => f.name === 'Finn Mercer-test')!.joinDate >= '2024-10-01').toBe(true);
    for (const f of fighters) expect(f.birthYear).toBe(2026 - f.age);
  });
});

describe('NACL-test world', () => {
  it('has 15 historical events: 9 AB, 2 BC, 2 SK, 2 MB, May 2023 to Sep 2026', () => {
    const ev = world.events.map(e => e.event);
    expect(ev).toHaveLength(15);
    const by = (p: string) => ev.filter(e => e.prov === p).length;
    expect([by('AB'), by('BC'), by('SK'), by('MB')]).toEqual([9, 2, 2, 2]);
    expect(ev[0].start >= '2023-05-01' && ev[14].end <= '2026-09-30').toBe(true);
  });
  it('never lets a fighter attend before joining', () => {
    for (const e of [...world.events, world.rumble]) for (const i of e.attendees) expect(fighters[i].joinDate < e.event.start).toBe(true);
  });
  it('team rosters have exactly the format size; a fighter is in one entry per competition; mercenaries come from another team', () => {
    for (const e of [...world.events, world.rumble]) for (const c of e.comps) {
      const seen = new Set<number>();
      for (const en of c.entries) {
        const members = en.fighterIdx !== null ? [en.fighterIdx] : en.roster.map(s => s.fighterIdx);
        if (en.fighterIdx === null) expect(en.roster).toHaveLength(SIDE_SIZE[c.div.cat as '5v5' | '3v3']);
        for (const m of members) { expect(seen.has(m)).toBe(false); seen.add(m); expect(fighters[m].disciplines).toContain(c.div.cat); expect(fighters[m].sex).toBe(c.div.gender === 'men' ? 'male' : 'female'); }
        for (const s of en.roster) expect(s.role === 'mercenary').toBe(fighters[s.fighterIdx].teamIdx !== en.teamIdx);
      }
    }
  });
  it('has different attendance every event and the planned sizes', () => {
    const sets = world.events.map(e => [...e.attendees].sort((a, b) => a - b).join(','));
    expect(new Set(sets).size).toBe(15);
    for (const e of world.events) {
      const n = e.attendees.size;
      const [lo, hi] = e.event.size === 'small' ? [20, 25] : e.event.size === 'medium' ? [30, 40] : [40, 55];
      expect(n).toBeGreaterThanOrEqual(lo);
      expect(n).toBeLessThanOrEqual(hi);
    }
  });
  it('plays every historical match and leaves the current event drawn but unplayed', () => {
    for (const e of world.events) for (const s of e.sims) for (const phase of s.phases) for (const m of phase) { expect(m.outcome).not.toBeNull(); expect(m.field).not.toBeNull(); }
    for (const s of world.rumble.sims) for (const phase of s.phases) for (const m of phase) { expect(m.outcome).toBeNull(); expect(m.startLocal).not.toBeNull(); expect(m.duration).toBeGreaterThan(0); }
  });
  it('current event: about 40 fighters (25-30 men, 10-15 women), about 90 category registrations, mercenaries, Aldric in three divisions', () => {
    const r = world.rumble;
    const men = [...r.attendees].filter(i => fighters[i].sex === 'male').length;
    expect(r.attendees.size).toBeGreaterThanOrEqual(38);
    expect(r.attendees.size).toBeLessThanOrEqual(44);
    expect(men).toBeGreaterThanOrEqual(25);
    expect(men).toBeLessThanOrEqual(30);
    expect(registrations(r)).toBeGreaterThan(r.attendees.size);
    expect(registrations(r)).toBeGreaterThanOrEqual(72);
    expect(r.comps.some(c => c.entries.some(e => e.roster.some(s => s.role === 'mercenary')))).toBe(true);
    const aldric = fighters.find(f => f.name === 'Aldric Stone-test')!.idx;
    expect(r.comps.filter(c => c.entries.some(e => e.fighterIdx === aldric || e.roster.some(s => s.fighterIdx === aldric)))).toHaveLength(3);
  });
});

describe('NACL-test SQL', () => {
  it('is deterministic and chunked under 400 KB, with the owner id as a placeholder', () => {
    const a = generate(null), b = generate(null);
    expect(a.map(f => f.name)).toEqual(b.map(f => f.name));
    expect(a.map(f => f.sql)).toEqual(b.map(f => f.sql));
    for (const f of a) expect(Buffer.byteLength(f.sql)).toBeLessThan(400_000);
    expect(a.filter(f => f.name.startsWith('1') || f.name.startsWith('2') || f.name.startsWith('3')).every(f => f.sql.includes('__OWNER_ID__'))).toBe(true);
    expect(a.map(f => f.sql).join('').includes('public.finalize_match(')).toBe(true);
  });
  it('never writes placements or points itself: results come from finish_competition', () => {
    const all = generate(null).map(f => f.sql).join('\n');
    expect(all).not.toMatch(/insert into public\.results/i);
    expect(all).not.toMatch(/insert into public\.ranking/i);
    expect(all).toMatch(/finish_competition/);
  });
});
