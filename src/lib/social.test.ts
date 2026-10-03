import { describe, expect, it } from 'vitest';
import { cleanSocialLinks, hostLabel, normalizeSocialUrl, socialLinkErrors, visibleSocialLinks } from './social';

describe('social link normalising (what a phone keyboard produces)', () => {
  it('fixes an auto-capitalised scheme and http', () => {
    expect(normalizeSocialUrl('facebook', 'Https://www.facebook.com/share/19bgXGygp8/')).toBe('https://www.facebook.com/share/19bgXGygp8/');
    expect(normalizeSocialUrl('x', 'http://x.com/reavers')).toBe('https://x.com/reavers');
  });
  it('adds https:// to a bare domain', () => {
    expect(normalizeSocialUrl('instagram', ' www.instagram.com/reavers.ab ')).toBe('https://www.instagram.com/reavers.ab');
    expect(normalizeSocialUrl('other', 'reavers.example/about')).toBe('https://reavers.example/about');
  });
  it('turns a handle into the profile address for networks that have one', () => {
    expect(normalizeSocialUrl('instagram', '@reavers')).toBe('https://www.instagram.com/reavers');
    expect(normalizeSocialUrl('tiktok', 'reavers_ab')).toBe('https://www.tiktok.com/@reavers_ab');
    expect(normalizeSocialUrl('discord', 'reavers')).toBe('reavers'); // no known profile address: left for the validator
  });
  it('leaves a good address alone and blanks stay blank', () => {
    expect(normalizeSocialUrl('discord', 'https://discord.gg/abc')).toBe('https://discord.gg/abc');
    expect(normalizeSocialUrl('x', '   ')).toBe('');
  });
});

describe('social link validation and cleaning', () => {
  it('names the network that is wrong and accepts the rest', () => {
    const e = socialLinkErrors({ facebook: 'https://www.facebook.com/a', discord: 'reavers', x: '' });
    expect(Object.keys(e)).toEqual(['discord']);
    expect(e.discord).toContain('Discord');
  });
  it('sends only the set links, in network order', () => {
    expect(cleanSocialLinks({ x: ' https://x.com/a ', facebook: 'https://www.facebook.com/a', youtube: '' })).toEqual({ facebook: 'https://www.facebook.com/a', x: 'https://x.com/a' });
  });
  it('shows only safe https links, never javascript: or http:', () => {
    expect(visibleSocialLinks({ facebook: 'https://www.facebook.com/a', x: 'javascript:alert(1)', other: 'http://plain.example' }).map(l => l.network)).toEqual(['facebook']);
    expect(visibleSocialLinks(null)).toEqual([]);
  });
  it('labels a website by its host', () => {
    expect(hostLabel('https://www.reavers.example/about')).toBe('reavers.example');
    expect(hostLabel('nonsense')).toBe('Website');
  });
});
