import { describe, expect, it } from 'vitest';
import { parseRuleBody, plainBody, type BodyTable } from './body';

// The shape of Duel Regulations 3.2 as the importer stores it (merged cells across rows, paragraphs inside cells).
const DUEL = `The organizers can alter the length of the fights.

| Category | End of round | Break | Technical win |
| --- | --- | --- | --- |
| Longsword | 60 seconds of effective time | 30 seconds to rest | 10-0 |
| Sword and shield | ^ | ^ | ^ |
| Triathlon | ^ | 30 seconds to rest .<br>120 seconds to change | |
| Sword and buckler | 5 clean blows | No break | 5-0 |

After the table.`;

describe('reading a stored provision body', () => {
  const blocks = parseRuleBody(DUEL);
  const t = blocks[1] as BodyTable;
  it('keeps the paragraphs around a table', () => {
    expect(blocks.map(b => b.kind)).toEqual(['text', 'table', 'text']);
    expect(blocks[2]).toEqual({ kind: 'text', text: 'After the table.' });
  });
  it('reads the heading row and merges "^" cells into the cell above', () => {
    expect(t.head[0].map(c => c?.text)).toEqual(['Category', 'End of round', 'Break', 'Technical win']);
    expect(t.rows[0][1]).toEqual({ text: '60 seconds of effective time', rowSpan: 3, colSpan: 1 });
    expect(t.rows[0][2]?.rowSpan).toBe(2);
    expect(t.rows[0][3]?.rowSpan).toBe(2);
    expect(t.rows[1][1]).toBeNull();
    expect(t.rows[2][2]?.text).toBe('30 seconds to rest .<br>120 seconds to change');
    expect(t.rows[2][3]).toEqual({ text: '', rowSpan: 1, colSpan: 1 });
  });
  it('merges "<" cells into the cell on the left, and a "^" under a merged cell joins it', () => {
    const b = parseRuleBody('|  | Buhurt | Duels |\n| --- | --- | --- |\n| Points given | 50 % | < |\n| Marshal | 1 Regional | < |')[0] as BodyTable;
    expect(b.rows[0][1]).toEqual({ text: '50 %', rowSpan: 1, colSpan: 2 });
    expect(b.rows[0][2]).toBeNull();
    const c = parseRuleBody('| A | B | C |\n| x | < | y |\n| ^ | ^ | z |')[0] as BodyTable;
    expect(c.head).toEqual([]);
    expect(c.rows[1][0]).toEqual({ text: 'x', rowSpan: 2, colSpan: 2 });
    expect(c.rows[2][0]).toBeNull();
    expect(c.rows[2][1]).toBeNull();
  });
  it('gives the words only for search and previews: no pipes, no merge marks, no <br>', () => {
    const p = plainBody(DUEL);
    expect(p).not.toMatch(/\||\^|<br>|---/);
    expect(p).toContain('Sword and buckler · 5 clean blows · No break · 5-0');
    expect(plainBody('Just text.\nSecond line.')).toBe('Just text.\nSecond line.');
  });
  it('plain text without a table is unchanged', () => {
    expect(parseRuleBody('One.\n\nTwo.')).toEqual([{ kind: 'text', text: 'One.' }, { kind: 'text', text: 'Two.' }]);
    expect(parseRuleBody('')).toEqual([]);
  });
});
