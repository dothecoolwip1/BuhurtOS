import { describe, expect, it } from 'vitest';
import { appPath, authErrorMessage, authUrlError, hadAuthCode, linkErrorMessage, looksLikeEmail, newPasswordProblem, safeNext, siteUrl } from './authFlow';

describe('auth wording never reveals whether an account exists', () => {
  it('a wrong password and an unknown email read the same', () => {
    // Supabase answers both with invalid_credentials; the words must not split them either
    const wrong = authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 }, 'sign_in');
    const unknown = authErrorMessage({ message: 'Invalid login credentials', status: 400 }, 'sign_in');
    expect(wrong).toBe(unknown);
    expect(wrong).not.toMatch(/no account|not registered|does not exist|not found/i);
  });
  it('an existing address on sign-up does not say "already registered"', () => {
    const t = authErrorMessage({ code: 'user_already_exists', message: 'User already registered' }, 'sign_up');
    expect(t).not.toMatch(/already registered|already exists/i);
    expect(t).toMatch(/Forgot password/);
  });
  it('rate limits, offline-like failures and unknown errors are plain and generic', () => {
    expect(authErrorMessage({ code: 'over_email_send_rate_limit', status: 429 }, 'reset_request')).toMatch(/Too many attempts/);
    expect(authErrorMessage({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }, 'sign_in')).toMatch(/Could not reach/);
    expect(authErrorMessage({ code: 'something_new', message: 'internal detail xyz' }, 'sign_in')).toBe('Something went wrong. Please try again.');
  });
  it('change password: a wrong current password says so', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' }, 'change_password')).toBe('Your current password is not right.');
    expect(authErrorMessage({ code: 'current_password_invalid' }, 'change_password')).toBe('Your current password is not right.');
    expect(authErrorMessage({ code: 'same_password' }, 'change_password')).toMatch(/different/);
  });
});

describe('the per-address email limit is not an enumeration leak', () => {
  it('is recognised (and only that code)', async () => {
    const { isPerAddressLimit } = await import('./authFlow');
    expect(isPerAddressLimit({ code: 'over_email_send_rate_limit', status: 429 })).toBe(true);
    expect(isPerAddressLimit({ code: 'over_request_rate_limit', status: 429 })).toBe(false);
    expect(isPerAddressLimit(null)).toBe(false);
  });
});

describe('passwords and addresses', () => {
  it('new password: length and match', () => {
    expect(newPasswordProblem('short')).toMatch(/at least 8/);
    expect(newPasswordProblem('long-enough-1', 'long-enough-2')).toMatch(/do not match/);
    expect(newPasswordProblem('long-enough-1', 'long-enough-1')).toBeNull();
    expect(newPasswordProblem('x'.repeat(73))).toMatch(/at most 72/);
  });
  it('email shape', () => {
    expect(looksLikeEmail(' a@b.co ')).toBe(true);
    expect(looksLikeEmail('a@b')).toBe(false);
    expect(looksLikeEmail('nope')).toBe(false);
  });
});

describe('where to go afterwards', () => {
  it('only paths inside BuhurtOS', () => {
    expect(safeNext('/events/rumble#my-next-fight')).toBe('/events/rumble#my-next-fight');
    expect(safeNext(encodeURIComponent('/events/rumble?tab=x'))).toBe('/events/rumble?tab=x');
    expect(safeNext('https://evil.example/')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('javascript:alert(1)')).toBe('/');
    expect(safeNext('/reset-password')).toBe('/');
    expect(safeNext(null, '/account')).toBe('/account');
  });
  it('email links come back to this deployment, with or without a base path', () => {
    expect(siteUrl('https://x.test', '/', '/reset-password?next=%2Fa')).toBe('https://x.test/reset-password?next=%2Fa');
    expect(siteUrl('https://x.test', '/BuhurtOS/', '/reset-password')).toBe('https://x.test/BuhurtOS/reset-password');
    expect(appPath('/BuhurtOS/events/a', '?q=1', '#f', '/BuhurtOS/')).toBe('/events/a?q=1#f');
    expect(appPath('/events/a', '', '', '/')).toBe('/events/a');
  });
});

describe('links Supabase could not honour', () => {
  it('reads the error from the hash or the query', () => {
    expect(authUrlError('https://x.test/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'))
      .toEqual({ code: 'otp_expired', description: 'Email link is invalid or has expired' });
    expect(authUrlError('https://x.test/reset-password?error=access_denied&error_description=gone')).toEqual({ code: 'access_denied', description: 'gone' });
    expect(authUrlError('https://x.test/reset-password')).toBeNull();
    expect(linkErrorMessage({ code: 'otp_expired', description: '' })).toMatch(/expired or was already used/);
  });
  it('knows when a page load carried a one-time code', () => {
    expect(hadAuthCode('https://x.test/reset-password?code=abc')).toBe(true);
    expect(hadAuthCode('https://x.test/#access_token=a&type=recovery')).toBe(true);
    expect(hadAuthCode('https://x.test/reset-password')).toBe(false);
  });
});
