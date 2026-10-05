import { describe, expect, it } from 'vitest';
import { parseStream } from './stream';
import { visibleSponsors, type Sponsor } from './sponsors';
import { RED, BLUE, cornerFor, formatRecord, presentSide, type SideSource } from './sides';
import { COMPLETE_MS, broadcastScene } from './state';
import type { ArenaFight, ArenaLyst, ArenaView } from '../arena';

describe('stream addresses: allow-list, embeddable or not', () => {
  const host = 'buhurtos.example';
  it('YouTube forms embed through the privacy-enhanced player', () => {
    expect(parseStream('https://www.youtube.com/watch?v=abcdefghijk', host)?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0&modestbranding=1');
    expect(parseStream('https://youtu.be/abcdefghijk', host)?.embedUrl).toContain('/embed/abcdefghijk');
    expect(parseStream('https://www.youtube.com/live/abcdefghijk', host)?.embedUrl).toContain('/embed/abcdefghijk');
    expect(parseStream('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', host)?.embedUrl).toContain('live_stream?channel=UCabcdefghijklmnopqrstuv');
  });
  it('a YouTube @handle is a valid address but cannot be embedded: a link only', () => {
    const s = parseStream('https://www.youtube.com/@buhurtos', host);
    expect(s).toMatchObject({ provider: 'youtube', embedUrl: null });
  });
  it('Twitch needs the page host as the parent, and encodes it', () => {
    expect(parseStream('https://www.twitch.tv/buhurtos', 'a b.example')?.embedUrl).toBe('https://player.twitch.tv/?channel=buhurtos&parent=a%20b.example&autoplay=false');
    expect(parseStream('https://www.twitch.tv/videos/123456', host)?.embedUrl).toContain('video=123456');
  });
  it('Vimeo video and event forms', () => {
    expect(parseStream('https://vimeo.com/123456789', host)?.embedUrl).toBe('https://player.vimeo.com/video/123456789');
    expect(parseStream('https://vimeo.com/event/123456', host)?.embedUrl).toBe('https://player.vimeo.com/event/123456/embed');
  });
  it('refuses everything else: http, script addresses, other hosts, look-alike hosts, junk', () => {
    for (const bad of ['http://www.youtube.com/watch?v=abcdefghijk', 'javascript:alert(1)', 'https://evil.test/watch', 'https://youtube.com.evil.test/x', 'https://evilyoutube.com/x',
      'https://www.youtube.com/a b', '', '   ', 'data:text/html,<script>', 'https://youtube.com@evil.test/x', 'https://twitch.tv.evil.test/x'])
      expect(parseStream(bad, host), bad).toBeNull();
    expect(parseStream(null, host)).toBeNull();
    expect(parseStream(`https://www.youtube.com/watch?v=abcdefghijk${'x'.repeat(300)}`, host)).toBeNull();
  });
  it('a malformed id never reaches the iframe address', () => {
    expect(parseStream('https://www.youtube.com/watch?v=<script>', host)?.embedUrl ?? null).toBeNull();
    expect(parseStream('https://vimeo.com/abc', host)?.embedUrl ?? null).toBeNull();
  });
});

const sp = (n: number, tier: Sponsor['tier'] = 'partner', on = true): Sponsor => ({ id: `s${n}`, name: `S${n}`, logoUrl: null, linkUrl: null, tier, sortOrder: n, onBroadcast: on });
describe('sponsors', () => {
  it('title sponsors are always shown; partners rotate in windows, deterministically from the clock', () => {
    const all = [sp(1, 'title'), ...[2, 3, 4, 5, 6, 7, 8].map(n => sp(n))];
    const a = visibleSponsors(all, 0, 8, 3), b = visibleSponsors(all, 8_000, 8, 3), c = visibleSponsors(all, 16_000, 8, 3), d = visibleSponsors(all, 24_000, 8, 3);
    expect(a.title.map(s => s.id)).toEqual(['s1']);
    expect(a.partners.map(s => s.id)).toEqual(['s2', 's3', 's4']);
    expect(b.partners.map(s => s.id)).toEqual(['s5', 's6', 's7']);
    expect(c.partners.map(s => s.id)).toEqual(['s8']);
    expect(d.partners.map(s => s.id)).toEqual(['s2', 's3', 's4']);
    expect(visibleSponsors(all, 3_000, 8, 3).partners).toEqual(a.partners);   // inside the same slot nothing moves
    expect(a.pages).toBe(3);
  });
  it('sponsors hidden from the broadcast are not shown; no sponsors is calm', () => {
    expect(visibleSponsors([sp(1, 'partner', false)], 0, 8).partners).toEqual([]);
    expect(visibleSponsors([], 0, 8)).toMatchObject({ title: [], partners: [], pages: 1 });
  });
  it('fewer partners than a window do not rotate', () => { expect(visibleSponsors([sp(1), sp(2)], 99_000, 8).partners).toHaveLength(2); });
  it('a rotation time under 3 seconds is held to 3', () => { expect(visibleSponsors([1, 2, 3, 4].map(n => sp(n)), 2_999, 1, 1).page).toBe(visibleSponsors([1, 2, 3, 4].map(n => sp(n)), 0, 1, 1).page); });
});

describe('fighter and team presentation', () => {
  const team = { id: 't', name: 'Iron Wolves', colors: ['#2C4A8C', '#E9ECEF'] as [string, string], division: 'pale' as const, initial: 'I', emblemUrl: null, city: 'Red Deer', region: 'AB', country: 'Canada' };
  const fighter: SideSource = { entryId: 'e1', kind: 'fighter', name: 'Aldric Stone', team, avatarUrl: 'https://x/a.jpg', record: { wins: 5, losses: 2, draws: 1, test: false } };
  it('red and blue corners by default; team colours on request; text colour stays readable', () => {
    expect(cornerFor('a', 'red_blue', team)).toMatchObject({ color: RED, label: 'RED' });
    expect(cornerFor('b', 'red_blue', null)).toMatchObject({ color: BLUE, label: 'BLUE' });
    expect(cornerFor('a', 'team_colors', team)).toMatchObject({ color: '#2C4A8C', label: 'A', ink: '#FFFFFF' });
    expect(cornerFor('b', 'team_colors', { ...team, colors: ['#F4E04D', '#000000'] }).ink).toBe('#10151D');
    expect(cornerFor('b', 'team_colors', null)).toMatchObject({ color: BLUE });
  });
  it('a fighter shows the team under the name, a record and a photo; switches turn them off', () => {
    const on = presentSide(fighter, 'a', 'Fighter A', { scheme: 'red_blue', records: true, photos: true });
    expect(on).toMatchObject({ name: 'Aldric Stone', subtitle: 'Iron Wolves', record: '5-2-1', avatarUrl: 'https://x/a.jpg', place: 'Red Deer, AB' });
    expect(on.crest?.name).toBe('Iron Wolves');
    const off = presentSide(fighter, 'a', 'Fighter A', { scheme: 'red_blue', records: false, photos: false });
    expect(off).toMatchObject({ record: null, avatarUrl: null });
  });
  it('a team entry shows its place, no photo; a draw-free record has no third number', () => {
    const t: SideSource = { entryId: 'e2', kind: 'team', name: 'Iron Wolves', team, avatarUrl: 'https://x/ignored.jpg', record: { wins: 3, losses: 0, draws: 0, test: false } };
    const p = presentSide(t, 'b', 'Team B', { scheme: 'red_blue', records: true, photos: true });
    expect(p).toMatchObject({ subtitle: 'Red Deer, AB', avatarUrl: null, record: '3-0' });
    expect(formatRecord({ wins: 0, losses: 0, draws: 0 })).toBe('0-0');
  });
  it('nothing is invented when data is missing; a test record is labelled', () => {
    const p = presentSide(null, 'a', 'To be decided', { scheme: 'red_blue', records: true, photos: true });
    expect(p).toMatchObject({ name: 'To be decided', subtitle: null, record: null, avatarUrl: null, crest: null });
    expect(presentSide({ ...fighter, record: { wins: 1, losses: 0, draws: 0, test: true } }, 'a', 'x', { scheme: 'red_blue', records: true, photos: true }).recordNote).toBe('test record');
  });
});

const NOW = Date.parse('2026-10-08T18:00:00Z');
const fight = (id: string, over: Partial<ArenaFight> = {}): ArenaFight => ({ id, competition: 'Longsword', stage: 'Round 1', a: { name: `${id}A`, score: 0, winner: false }, b: { name: `${id}B`, score: 0, winner: false }, phase: null, live: false, detail: null, ...over });
const lyst = (over: Partial<ArenaLyst> = {}): ArenaLyst => ({ round: 1, roundStatus: 'running', roundsConfirmed: 0, timer: { mode: 'fight', status: 'running', remainingMs: 40_000, startedAt: new Date(NOW).toISOString(), round: 1 }, marks: [], ...over });
const view = (state: ArenaView['state'], over: Partial<ArenaView> = {}): ArenaView => ({ field: 'Field 1', state, onDeck: fight('d'), inTheHole: fight('h'), upNext: [fight('u1'), fight('u2')], done: 2, total: 8, ...over });
const live = (l: ArenaLyst | undefined, f: Partial<ArenaFight> = {}) => view({ kind: 'fighting', now: fight('n', { live: true, ...(l ? { lyst: l } : {}), ...f }) });
const ctx = { phase: 'current' as const, nowMs: NOW };

describe('broadcast scenes: derived from existing state, never operated', () => {
  it('nothing posted, or the field is complete: idle', () => {
    expect(broadcastScene(view({ kind: 'no_matches' }), ctx).mode).toBe('idle');
    expect(broadcastScene(view({ kind: 'finished' }), ctx).mode).toBe('idle');
    expect(broadcastScene(view({ kind: 'waiting', next: null }, { onDeck: null, inTheHole: null, upNext: [] }), ctx).mode).toBe('idle');
  });
  it('before the event or before anything was fought: upcoming; later: between fights', () => {
    expect(broadcastScene(view({ kind: 'waiting', next: fight('x') }), { phase: 'upcoming', nowMs: NOW }).mode).toBe('upcoming');
    expect(broadcastScene(view({ kind: 'waiting', next: fight('x') }, { done: 0 }), ctx).mode).toBe('upcoming');
    const b = broadcastScene(view({ kind: 'waiting', next: fight('x') }), ctx);
    expect(b.mode).toBe('between');
    expect(b.next?.id).toBe('x');
  });
  it('a fight called to the field with no round and no clock: intro; with an armed clock: ready', () => {
    expect(broadcastScene(live(lyst({ round: null, roundStatus: null, timer: null }), { live: true }), ctx).mode).toBe('intro');
    expect(broadcastScene(live(lyst({ round: null, roundStatus: null, timer: { mode: 'fight', status: 'idle', remainingMs: 60_000, startedAt: null, round: 1 } })), ctx).mode).toBe('ready');
    expect(broadcastScene(live(undefined, { live: false }), ctx).mode).toBe('intro');
  });
  it('a round in progress: live while the clock runs, paused when it does not; the classic board is live once it reports', () => {
    expect(broadcastScene(live(lyst()), ctx).mode).toBe('live');
    expect(broadcastScene(live(lyst({ timer: { mode: 'fight', status: 'paused', remainingMs: 31_000, startedAt: null, round: 1 } })), ctx).mode).toBe('paused');
    expect(broadcastScene(live(undefined, { live: true }), ctx).mode).toBe('live');
  });
  it('the break, "scores being confirmed" and the gap between rounds are all the break scene', () => {
    expect(broadcastScene(live(lyst({ roundStatus: 'confirming', timer: { mode: 'break', status: 'running', remainingMs: 25_000, startedAt: null, round: 1 } })), ctx).mode).toBe('break');
    expect(broadcastScene(live(lyst({ roundStatus: 'confirming', timer: null })), ctx).mode).toBe('break');
    expect(broadcastScene(live(lyst({ roundStatus: 'confirmed', roundsConfirmed: 1 })), ctx).mode).toBe('break');
  });
  it('equipment timeout and DQ countdown are their own scenes and carry their clock', () => {
    const eq = broadcastScene(live(lyst({ timer: { mode: 'equipment', status: 'running', remainingMs: 50_000, startedAt: null, round: 1 } })), ctx);
    expect(eq).toMatchObject({ mode: 'equipment', clock: { mode: 'equipment' } });
    expect(broadcastScene(live(lyst({ timer: { mode: 'dq', status: 'running', remainingMs: 50_000, startedAt: null, round: 1 } })), ctx).mode).toBe('dq_clock');
  });
  it('a disqualification on record wins over the round state and names the side', () => {
    const s = broadcastScene(live(lyst({ marks: [{ side: 'b', text: 'Disqualified', kind: 'dq' }] })), ctx);
    expect(s).toMatchObject({ mode: 'disqualified', disqualified: 'b' });
    expect(broadcastScene(live(lyst({ marks: [{ side: 'b', text: 'Yellow card', kind: 'card' }] })), ctx).mode).toBe('live');   // cards alone do not change the scene
  });
  it('a result: match complete for the first seconds, then the winner card; the next fight is announced beside it', () => {
    const fin = (ageMs: number) => view({ kind: 'result', result: fight('r', { finalizedAt: new Date(NOW - ageMs).toISOString(), a: { name: 'RA', score: 13, winner: true }, b: { name: 'RB', score: 9, winner: false } }), winnerName: 'RA', drawn: false, next: fight('nx') });
    const a = broadcastScene(fin(1_000), ctx), b = broadcastScene(fin(COMPLETE_MS + 1), ctx);
    expect(a).toMatchObject({ mode: 'complete', winner: { side: 'a', name: 'RA' } });
    expect(b).toMatchObject({ mode: 'winner', winner: { side: 'a' } });
    expect(b.next?.id).toBe('nx');
    const draw = broadcastScene(view({ kind: 'result', result: fight('r', { finalizedAt: new Date(NOW - 9_000).toISOString() }), winnerName: null, drawn: true, next: null }), ctx);
    expect(draw.winner).toEqual({ side: 'draw', name: null });
  });
  it('the scene always carries the queue (up next and following) from the same view', () => {
    const s = broadcastScene(live(lyst()), ctx);
    expect(s.next?.id).toBe('d');
    expect(s.following.map(f => f.id)).toEqual(['u1', 'u2']);
    expect(s).toMatchObject({ field: 'Field 1', done: 2, total: 8, round: 1 });
  });
});
