import { describe, expect, it } from 'vitest';
import { bannerLines, reasonLabel, roleWords, REASONS } from './cameraOff';

describe('Camera Off wording', () => {
  it('names who turned the cameras off, why, and who may turn them back on', () => {
    const base = { activatedByLabel: 'Marshal Phone', activatedByRole: 'marshal', activatedAt: '2026-10-10T19:42:00-06:00', reason: 'medical' as const };
    const waiting = bannerLines({ ...base, canRelease: false });
    expect(waiting[0]).toBe('CAMERAS OFF');
    expect(waiting).toContain('Reason: Medical / injury');
    expect(waiting).toContain('Activated by: Marshal Phone (Marshal)');
    expect(waiting.at(-1)).toBe('Waiting for authorized release (head marshal or event admin).');
    expect(bannerLines({ ...base, canRelease: true }).at(-1)).toContain('only when it is safe');
  });
  it('has a plain word for every reason and role, and a safe default', () => {
    for (const r of REASONS) expect(reasonLabel(r.id)).toBe(r.label);
    expect(reasonLabel(null)).toBe('Safety hold');
    expect(roleWords('scorekeeper')).toBe('Secretary / Scorekeeper');
    expect(roleWords('temporary_organizer')).toBe('Event Admin');
    expect(roleWords(null)).toBe('Staff');
  });
});
