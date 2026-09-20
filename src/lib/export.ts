import type { MatchRecord } from '../types';
import type { StandingRow } from './standings';

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function standingsCsv(rows: StandingRow[]): string {
  const header = ['Rank', 'Competitor', 'Matches', 'Wins', 'Losses', 'Draws', 'Points For', 'Points Against', 'Differential', 'Standing Points'];
  const lines = rows.map((r, index) => [index + 1, r.name, r.matches, r.wins, r.losses, r.draws, r.pointsFor, r.pointsAgainst, r.differential, r.standingPoints]);
  return [header, ...lines].map(row => row.map(csvCell).join(',')).join('\n');
}

export function matchesCsv(matches: MatchRecord[]): string {
  const header = ['Order', 'Label', 'Category', 'Stage', 'Status', 'Winner Side', 'Side 1 Total', 'Side 2 Total'];
  const lines = matches.map(m => [m.scheduledOrder, m.label, m.category, m.stage, m.status, m.resultSummary?.winnerSide ?? '', m.resultSummary?.side1Total ?? '', m.resultSummary?.side2Total ?? '']);
  return [header, ...lines].map(row => row.map(csvCell).join(',')).join('\n');
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function openPrintableReport(title: string, bodyHtml: string): void {
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) throw new Error('Pop-up blocked. Allow pop-ups to create the printable report.');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui;padding:32px;color:#111}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}h1{margin-top:0}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / Save PDF</button><h1>${title}</h1>${bodyHtml}</body></html>`);
  win.document.close();
}
