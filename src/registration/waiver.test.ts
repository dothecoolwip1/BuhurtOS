import { describe, expect, it } from 'vitest';
import { WAIVER_TEMPLATE, WAIVER_TEMPLATE_NOTICE, templatePlaceholders } from '../content/waiverTemplate';
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
