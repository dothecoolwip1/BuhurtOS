import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { isTestEmail } from './TestLoginPage';

describe('test sign-in', () => {
  it('accepts only the test domain, whatever the case or spacing', () => {
    expect(isTestEmail('fighter@buhurtos.ca')).toBe(true);
    expect(isTestEmail('  Captain@BuhurtOS.CA ')).toBe(true);
    expect(isTestEmail('garrett@gmail.com')).toBe(false);
    expect(isTestEmail('x@buhurtos.ca.evil.com')).toBe(false);
  });
});
