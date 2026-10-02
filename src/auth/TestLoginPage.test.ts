import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { isTestEmail } from './TestLoginPage';

describe('test sign-in', () => {
  it('accepts only the test domain, whatever the case or spacing', () => {
    expect(isTestEmail('fighter@buhurtos-test.example')).toBe(true);
    expect(isTestEmail('  Captain@BuhurtOS-Test.Example ')).toBe(true);
    expect(isTestEmail('garrett@gmail.com')).toBe(false);
    expect(isTestEmail('x@buhurtos-test.example.evil.com')).toBe(false);
  });
});
