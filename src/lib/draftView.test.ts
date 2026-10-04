import { describe, expect, it } from 'vitest';
import { maskEmail, notPublicMessage, splitDrafts } from './draftView';

describe('maskEmail', () => {
  it('masks the local part', () => {
    expect(maskEmail('garrettrobson95@gmail.com')).toBe('gar***@gmail.com');
    expect(maskEmail('ab@x.ca')).toBe('a***@x.ca');
    expect(maskEmail('abcd@x.ca')).toBe('ab***@x.ca');
  });
  it('handles missing or malformed input', () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail('')).toBeNull();
    expect(maskEmail('nope')).toBeNull();
    expect(maskEmail('@x.ca')).toBeNull();
  });
});
describe('notPublicMessage', () => {
  it('never contains the full address', () => {
    const m = notPublicMessage('garrettrobson95@gmail.com');
    expect(m).toContain('gar***@gmail.com');
    expect(m).not.toContain('garrettrobson95');
  });
  it('omits the account clause without an email', () => { expect(notPublicMessage(undefined)).not.toContain('signed in as'); });
});
describe('splitDrafts', () => {
  const ev = [{ id: 'a', status: 'draft' }, { id: 'b', status: 'published' }, { id: 'c', status: 'cancelled' }];
  it('separates drafts for signed-in viewers', () => {
    const r = splitDrafts(ev, true);
    expect(r.drafts.map(e => e.id)).toEqual(['a']);
    expect(r.published.map(e => e.id)).toEqual(['b', 'c']);
  });
  it('hides drafts when signed out', () => { expect(splitDrafts(ev, false).drafts).toEqual([]); });
});
