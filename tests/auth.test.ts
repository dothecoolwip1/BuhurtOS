import { describe, expect, it } from 'vitest';
import { safeOpsRedirect } from '../src/lib/auth';

describe('safeOpsRedirect', () => {
  it('keeps internal operations routes', () => {
    expect(safeOpsRedirect('/ops/roster?event=abc')).toBe('/ops/roster?event=abc');
  });

  it('rejects protocol and protocol-relative redirects', () => {
    expect(safeOpsRedirect('https://evil.example')).toBe('/ops');
    expect(safeOpsRedirect('//evil.example')).toBe('/ops');
  });

  it('rejects encoded external redirects and malformed values', () => {
    expect(safeOpsRedirect(encodeURIComponent('https://evil.example'))).toBe('/ops');
    expect(safeOpsRedirect('%E0%A4%A')).toBe('/ops');
  });

  it('rejects non-operations application routes', () => {
    expect(safeOpsRedirect('/public')).toBe('/ops');
  });
});
