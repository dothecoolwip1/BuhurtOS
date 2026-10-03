/** Pure rules for the waiver choices; the database re-checks everything. */
import { templatePlaceholders } from '../content/waiverTemplate';

export type WaiverChoice = 'template' | 'paste' | 'upload';
export const WAIVER_CHOICES: ReadonlyArray<readonly [WaiverChoice, string, string]> = [
  ['template', 'Use starter template', 'Start from the BuhurtOS starter text and edit it'],
  ['upload', 'Upload waiver', 'A PDF your organization already uses'],
  ['paste', 'Write or paste waiver', 'Your own text']
];

export const WAIVER_PDF_MAX_BYTES = 10 * 1024 * 1024;

/** Why a text waiver cannot be saved yet, or null. */
export function textWaiverProblem(title: string, body: string): string | null {
  if (title.trim().length < 3) return 'Give the waiver a title.';
  if (body.trim().length < 20) return 'Paste the full waiver text.';
  const left = templatePlaceholders(body);
  if (left.length > 0) return `Replace ${left.join(', ')} with your own words first.`;
  return null;
}

/** Why a file cannot be uploaded as the waiver, or null. */
export function pdfWaiverProblem(file: { type: string; size: number; name: string } | null): string | null {
  if (!file) return 'Choose a PDF file.';
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return 'Only PDF files can be uploaded as a waiver.';
  if (file.size > WAIVER_PDF_MAX_BYTES) return 'The PDF is too big (10 MB at most).';
  if (file.size === 0) return 'That file is empty.';
  return null;
}
