import { describe, expect, it } from 'vitest';
import { analyticsAllowed, consentModeFor } from './analyticsConsent';

const none = { gpc: false, dnt: false };
describe('analyticsAllowed', () => {
  it('runs by default after notice, in the default (Canada) mode', () => {
    expect(analyticsAllowed(null, 'notice', none)).toBe(true);
  });
  it('an explicit off always wins, even if the browser sends no signal', () => {
    expect(analyticsAllowed('off', 'notice', none)).toBe(false);
  });
  it('Global Privacy Control and Do Not Track count as off until the person turns analytics on', () => {
    expect(analyticsAllowed(null, 'notice', { gpc: true, dnt: false })).toBe(false);
    expect(analyticsAllowed(null, 'notice', { gpc: false, dnt: true })).toBe(false);
    expect(analyticsAllowed('on', 'notice', { gpc: true, dnt: true })).toBe(true);
  });
  it('opt-in mode stays off until the person says on', () => {
    expect(analyticsAllowed(null, 'opt-in', none)).toBe(false);
    expect(analyticsAllowed('on', 'opt-in', none)).toBe(true);
    expect(analyticsAllowed('off', 'opt-in', none)).toBe(false);
  });
});

describe('consentModeFor', () => {
  it('defaults to notice and honours the build setting', () => {
    expect(consentModeFor()).toBe('notice');
    expect(consentModeFor(undefined, 'opt-in')).toBe('opt-in');
    expect(consentModeFor('CA', undefined)).toBe('notice');
  });
});
