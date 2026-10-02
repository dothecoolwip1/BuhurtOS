import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { safeNext, validateProfileInput } from './profile';

describe('first sign-in profile', () => {
  it('needs a name and at least one way of taking part', () => {
    expect(validateProfileInput({ displayName: ' ', interests: [], city: '', region: '', country: '' })).toEqual({ displayName: 'Your name must be 2 to 80 characters.', interests: 'Choose at least one.' });
    expect(validateProfileInput({ displayName: 'Sam Doe', interests: ['fan'], city: '', region: '', country: '' })).toEqual({});
  });
  it('only returns to pages inside the app', () => {
    expect(safeNext('/events/x')).toBe('/events/x');
    expect(safeNext('//evil.example')).toBe('/account');
    expect(safeNext('https://evil.example')).toBe('/account');
    expect(safeNext('/welcome')).toBe('/account');
    expect(safeNext(null)).toBe('/account');
  });
});
