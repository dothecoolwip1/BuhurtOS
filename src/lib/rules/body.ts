/**
 * Pack 22: reading a provision's stored body. Official text is plain paragraphs; a table the official document prints is stored as rows
 * "| a | b |" (transcribed cell by cell by the importer's reviewed layout), with "| --- |" after the heading rows, "^" for a cell merged with the
 * one above, "<" for a cell merged with the one to its left and "<br>" between paragraphs inside a cell. These marks are layout, never words.
 */
export interface BodyCell { text: string; rowSpan: number; colSpan: number }
/** A grid where a merged-away position is null. */
export interface BodyTable { kind: 'table'; head: (BodyCell | null)[][]; rows: (BodyCell | null)[][] }
export type BodyBlock = { kind: 'text'; text: string } | BodyTable;

const isRow = (l: string) => /^\|.*\|\s*$/.test(l.trim());
const isRule = (l: string) => /^\|(\s*-{3,}\s*\|)+\s*$/.test(l.trim());
const cellsOf = (l: string) => l.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

function toGrid(raw: string[][]): (BodyCell | null)[][] {
  const width = Math.max(0, ...raw.map(r => r.length));
  const grid: (BodyCell | null)[][] = raw.map(r => Array.from({ length: width }, (_, i) => ({ text: r[i] ?? '', rowSpan: 1, colSpan: 1 })));
  // owner of each position, so a "^" below a "<" still finds the cell it belongs to
  const owner: ({ r: number; c: number } | null)[][] = grid.map(r => r.map(() => null));
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < width; c++) {
      const t = raw[r][c] ?? '';
      if (t === '<' && c > 0 && owner[r][c - 1]) {
        const o = owner[r][c - 1]!; owner[r][c] = o; grid[o.r][o.c]!.colSpan = Math.max(grid[o.r][o.c]!.colSpan, c - o.c + 1); grid[r][c] = null;
      } else if (t === '^' && r > 0 && owner[r - 1][c]) {
        const o = owner[r - 1][c]!; owner[r][c] = o; grid[o.r][o.c]!.rowSpan = Math.max(grid[o.r][o.c]!.rowSpan, r - o.r + 1); grid[r][c] = null;
      } else {
        owner[r][c] = { r, c };
      }
    }
  }
  return grid;
}

export function parseRuleBody(body: string): BodyBlock[] {
  const out: BodyBlock[] = [];
  const lines = body.split('\n');
  let text: string[] = [];
  const flushText = () => { const t = text.join('\n').replace(/^\n+|\n+$/g, ''); if (t) for (const para of t.split(/\n{2,}/)) out.push({ kind: 'text', text: para }); text = []; };
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i])) { text.push(lines[i]); continue; }
    flushText();
    const block: string[] = [];
    while (i < lines.length && isRow(lines[i])) block.push(lines[i++]);
    i--;
    const ruleAt = block.findIndex(isRule);
    const raw = block.filter(l => !isRule(l)).map(cellsOf);
    const head = ruleAt > 0 ? ruleAt : 0;
    // merges never cross the heading boundary: the heading rows and the body rows are separate grids
    out.push({ kind: 'table', head: head ? toGrid(raw.slice(0, head)) : [], rows: toGrid(raw.slice(head)) });
  }
  flushText();
  return out;
}

/** The words only (tables as their cell text): for search, snippets and short previews. */
export function plainBody(body: string): string {
  return body.split('\n').map(l => (isRule(l) ? '' : isRow(l) ? cellsOf(l).filter(c => c !== '^' && c !== '<').join(' · ').replace(/<br>/g, ' ') : l)).filter((l, i, a) => l || (i > 0 && a[i - 1])).join('\n').trim();
}
