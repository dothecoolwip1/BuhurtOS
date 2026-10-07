import { describe, expect, it } from 'vitest';
import { TOOLS, isToolKey, modesFor, toolFor, toolsOf } from './eventControl';
import { legacyManageTarget } from './eventPhaseView';

describe('Event Control tools', () => {
  it('every old Manage tab that was a screen is a tool here, and every tool has a home mode', () => {
    for (const tab of ['review', 'fighters', 'checkin', 'run', 'build', 'competitions', 'setup', 'people', 'teams', 'broadcast']) {
      const t = legacyManageTarget(tab);
      expect(t.tool, tab).toBeDefined();
      expect(isToolKey(t.tool), `${tab} → ${t.tool}`).toBe(true);
    }
    expect(TOOLS.every(t => ['setup', 'live', 'results'].includes(t.home))).toBe(true);
    expect(toolFor('nope')).toBeUndefined();
  });
  it('a non-organizer only gets Live ops; the day tools live under it', () => {
    expect(modesFor(false)).toEqual(['live']);
    expect(modesFor(true)).toEqual(['setup', 'live', 'results']);
    expect(toolsOf('live').map(t => t.key)).toEqual(['devices', 'checkin']);
  });
});
