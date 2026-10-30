import { describe, expect, it } from 'vitest';
import { injectRedirect, redirectTarget, SNIPPET } from './pagesRedirect.mjs';

describe('GitHub Pages copy forwards to buhurt-os.app', () => {
  it('keeps the page, query and hash', () => {
    expect(redirectTarget('/BuhurtOS/')).toBe('https://buhurt-os.app/');
    expect(redirectTarget('/BuhurtOS')).toBe('https://buhurt-os.app/');
    expect(redirectTarget('/BuhurtOS/events/red-deer-rumble/live', '?x=1', '#top')).toBe('https://buhurt-os.app/events/red-deer-rumble/live?x=1#top');
    expect(redirectTarget('/BuhurtOS/device', '', '#c=K7Q2M9XD4TRH')).toBe('https://buhurt-os.app/device#c=K7Q2M9XD4TRH');
  });
  it('only strips the /BuhurtOS prefix itself', () => {
    expect(redirectTarget('/BuhurtOSx/teams')).toBe('https://buhurt-os.app/BuhurtOSx/teams');
  });
  it('runs first in <head>, once, and checks the scoring queue before leaving', () => {
    const html = injectRedirect('<!doctype html><html><head><title>BuhurtOS</title></head><body></body></html>');
    expect(html.indexOf(SNIPPET)).toBeGreaterThan(html.indexOf('<head>'));
    expect(html.indexOf(SNIPPET)).toBeLessThan(html.indexOf('<title>'));
    expect(injectRedirect(html)).toBe(html);
    expect(SNIPPET).toContain("indexedDB.open('buhurtos-scoring')");
    expect(SNIPPET).toContain("status==='pending'");
  });
});
