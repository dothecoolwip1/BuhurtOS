import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { durationText, featureUsage, parseAnalytics, secondsText, zoneLabel, minutesBetween, pageLabel, summarizeActivity, validateBug, type Visit } from './admin';

const v = (o: Partial<Visit>): Visit => ({ sessionId: 's', userId: null, name: null, email: null, device: 'phone', startedAt: '2026-10-02T10:00:00Z', lastSeenAt: '2026-10-02T10:10:00Z', path: '/', pageCount: 1, online: false, ...o });

describe('activity', () => {
  it('names pages in plain words', () => {
    expect(pageLabel('/teams/bears/edit')).toBe('Editing a team');
    expect(pageLabel('/events/rumble/manage')).toBe('Managing an event');
    expect(pageLabel('/events/rumble')).toBe('An event page');
    expect(pageLabel('/')).toBe('Home');
    expect(pageLabel('/something-new')).toBe('/something-new');
  });
  it('sums up visits: people, visitors, online, average length', () => {
    const s = summarizeActivity([v({ userId: 'a', online: true }), v({ userId: 'a' }), v({ lastSeenAt: '2026-10-02T10:30:00Z' })]);
    expect(s).toEqual({ visits: 3, people: 1, visitors: 1, onlineNow: 1, avgMinutes: 17 });
    expect(summarizeActivity([]).avgMinutes).toBe(0);
  });
  it('counts at least a minute and writes durations simply', () => {
    expect(minutesBetween('2026-10-02T10:00:00Z', '2026-10-02T10:00:10Z')).toBe(1);
    expect(durationText(45)).toBe('45 min');
    expect(durationText(125)).toBe('2 h 5 min');
    expect(durationText(120)).toBe('2 h');
  });
  it('parses analytics and survives missing blocks', () => {
    const a = parseAnalytics({ totals: { visitors: 3, page_views: '7' }, pages: [{ path: '/teams', views: 4, visits: 2, avg_seconds: 30 }], referrers: [{ source: 'direct', n: 2 }] });
    expect(a.totals.visitors).toBe(3); expect(a.totals.pageViews).toBe(7); expect(a.totals.signups).toBe(0);
    expect(a.pages[0]).toEqual({ path: '/teams', views: 4, visits: 2, avgSeconds: 30 }); expect(a.referrers).toEqual([{ name: 'direct', n: 2 }]);
    expect(parseAnalytics(null).daily).toEqual([]);
  });
  it('words durations, zones and features', () => {
    expect([secondsText(45), secondsText(95), secondsText(4000)]).toEqual(['45 s', '1 min 35 s', '1 h 7 min']);
    expect([zoneLabel('America/Edmonton'), zoneLabel('America/Argentina/Buenos_Aires'), zoneLabel(null)]).toEqual(['Edmonton (America)', 'Argentina / Buenos Aires (America)', 'Unknown']);
    expect(featureUsage([{ path: '/teams', views: 2 }, { path: '/teams/bears', views: 3 }, { path: '/events/x/register', views: 1 }]))
      .toEqual([{ name: 'Team', n: 3 }, { name: 'Teams', n: 2 }, { name: 'Event', n: 1 }]);
  });
});

describe('bug report form', () => {
  it('needs a few words, and not an essay', () => {
    expect(validateBug({ what: 'hi', expected: '', contact: '', screenshot: null })).toMatch(/few words/);
    expect(validateBug({ what: 'Save does nothing', expected: '', contact: '', screenshot: null })).toBeNull();
    expect(validateBug({ what: 'x'.repeat(2001), expected: '', contact: '', screenshot: null })).toMatch(/under/);
  });
});
