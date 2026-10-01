import { beforeEach, describe, expect, it, vi } from 'vitest';
import { friendlyError } from './friendlyError';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('friendlyError', () => {
  it('passes through messages the database raised on purpose', () => {
    expect(friendlyError({ code: '22023', message: 'registration is closed' })).toBe('Registration is closed.');
  });
  it('explains a permission failure without raw detail', () => {
    expect(friendlyError({ code: '42501', message: 'new row violates row-level security policy for table "x"' })).toBe('You do not have permission to do that.');
  });
  it('hides unknown database errors', () => {
    expect(friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "events_slug_key"' })).toBe('Something went wrong. Please try again.');
  });
  it('explains a wrong sign-in code', () => {
    expect(friendlyError({ message: 'Token has expired or is invalid' })).toContain('code');
  });
  it('explains rate limiting', () => {
    expect(friendlyError({ message: 'email rate limit exceeded', status: 429 })).toContain('Too many');
  });
});
