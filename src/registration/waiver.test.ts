import { describe, expect, it } from 'vitest';
import { WAIVER_TEMPLATE, WAIVER_TEMPLATE_NOTICE, fillWaiverPlaceholders, missingHint, templatePlaceholders } from '../content/waiverTemplate';
import { pdfWaiverProblem, textWaiverProblem } from './waiver';

describe('waiver choices', () => {
  it('the starter template is labelled as a starter, not legal advice, and has placeholders to replace', () => {
    expect(WAIVER_TEMPLATE_NOTICE).toMatch(/not give legal advice/);
    expect(templatePlaceholders(WAIVER_TEMPLATE)).toEqual(expect.arrayContaining(['[EVENT NAME]', '[ORGANIZATION NAME]']));
  });
  it('a template cannot be saved until every placeholder is replaced', () => {
    expect(textWaiverProblem('Waiver', WAIVER_TEMPLATE)).toMatch(/Replace \[EVENT NAME\]/);
    expect(textWaiverProblem('Waiver', WAIVER_TEMPLATE.replace(/\[[A-Z][A-Z /]+\]/g, 'Red Deer Rumble'))).toBeNull();
  });
  it('text needs a title and real length', () => {
    expect(textWaiverProblem('', 'x'.repeat(30))).toMatch(/title/);
    expect(textWaiverProblem('Waiver', 'short')).toMatch(/full waiver text/);
  });
  it('uploads must be a PDF under 10 MB', () => {
    expect(pdfWaiverProblem(null)).toMatch(/Choose/);
    expect(pdfWaiverProblem({ type: 'image/png', size: 10, name: 'w.png' })).toMatch(/Only PDF/);
    expect(pdfWaiverProblem({ type: 'application/pdf', size: 11 * 1024 * 1024, name: 'w.pdf' })).toMatch(/too big/);
    expect(pdfWaiverProblem({ type: '', size: 500, name: 'waiver.PDF' })).toBeNull();
  });
});

describe('waiver placeholders are filled from the event', () => {
  const full = { eventName: 'Red Deer Rumble', organization: 'HACSA', venue: 'Westerner Park', region: 'Alberta' };
  it('keeps the brackets in the editor and writes the real words when saving', () => {
    const r = fillWaiverPlaceholders(WAIVER_TEMPLATE, full);
    expect(r.text).toContain('Red Deer Rumble, organized by HACSA ("the Organizer")');
    expect(r.text).toContain('the law of Alberta allows, I release HACSA');
    expect(r.text).toContain('the venue Westerner Park from claims');
    expect(r.filled).toEqual(['[EVENT NAME]', '[ORGANIZATION NAME]', '[PROVINCE / STATE]', '[VENUE NAME]']);
    expect(r.missing).toEqual([]);
    expect(textWaiverProblem('Waiver', r.text)).toBeNull();
  });
  it('leaves a placeholder alone when the event has no value, and says why', () => {
    const r = fillWaiverPlaceholders(WAIVER_TEMPLATE, { ...full, venue: null, region: '  ' });
    expect(r.missing).toEqual(['[PROVINCE / STATE]', '[VENUE NAME]']);
    expect(textWaiverProblem('Waiver', r.text)).toMatch(/Replace \[PROVINCE \/ STATE\], \[VENUE NAME\]/);
    expect(missingHint('[VENUE NAME]')).toMatch(/no venue yet/);
  });
  it('does not touch the organizer\'s own brackets or text that has none', () => {
    expect(fillWaiverPlaceholders('Contact [CLUB SECRETARY] about [EVENT NAME].', full)).toMatchObject({ text: 'Contact [CLUB SECRETARY] about Red Deer Rumble.', missing: ['[CLUB SECRETARY]'] });
    expect(fillWaiverPlaceholders('plain text', full)).toMatchObject({ text: 'plain text', filled: [], missing: [] });
  });
});
