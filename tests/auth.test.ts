import { describe, expect, it } from 'vitest';
import { authNoticeForEvent, sanitizeAuthReturnPath } from '../src/lib/auth';

describe('account redirect safety', () => {
  it('keeps protected BuhurtOS return paths', () => {
    expect(sanitizeAuthReturnPath('/ops/bracket?event=abc')).toBe('/ops/bracket?event=abc');
    expect(sanitizeAuthReturnPath('/ops')).toBe('/ops');
  });

  it('rejects external protocol relative and lookalike redirects', () => {
    expect(sanitizeAuthReturnPath('https://example.com/ops')).toBe('/ops');
    expect(sanitizeAuthReturnPath('//example.com/ops')).toBe('/ops');
    expect(sanitizeAuthReturnPath('/ops-evil')).toBe('/ops');
    expect(sanitizeAuthReturnPath('/public')).toBe('/ops');
    expect(sanitizeAuthReturnPath('/ops\\evil')).toBe('/ops');
  });
});

describe('session end messaging', () => {
  it('distinguishes an expired session from an intentional sign out', () => {
    expect(authNoticeForEvent('SIGNED_OUT', true, false)).toBe('session_expired');
    expect(authNoticeForEvent('SIGNED_OUT', true, true)).toBe('signed_out');
    expect(authNoticeForEvent('SIGNED_OUT', false, false)).toBeNull();
    expect(authNoticeForEvent('TOKEN_REFRESHED', true, false)).toBeNull();
  });
});
