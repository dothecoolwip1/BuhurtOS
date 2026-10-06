import { Fragment, type ReactNode } from 'react';
import { parseRuleBody, type BodyTable } from '../../lib/rules/body';

/**
 * The official words of a provision. Paragraphs keep their line breaks; a table the official document prints (stored as "| cell | cell |" rows,
 * transcribed from the page) is drawn as a table, with merged cells merged. A wide table scrolls inside its own box, never the page.
 */
export function RuleBody({ body, className = 'rl-body' }: { body: string; className?: string }) {
  const blocks = parseRuleBody(body);
  return (
    <div className={className}>
      {blocks.map((b, i) => (b.kind === 'text' ? <p key={i} className="rl-para">{b.text}</p> : <RuleTable key={i} t={b} />))}
    </div>
  );
}

function RuleTable({ t }: { t: BodyTable }) {
  const cell = (text: string) => text.split('<br>').map((part, i) => <Fragment key={i}>{i > 0 && <br />}{part}</Fragment>) as ReactNode;
  return (
    <div className="rl-tablewrap" role="region" aria-label="Table from the official document" tabIndex={0}>
      <table className="rl-table">
        {t.head.length > 0 && (
          <thead>{t.head.map((r, ri) => <tr key={ri}>{r.map((c, ci) => c && <th key={ci} scope="col" rowSpan={c.rowSpan} colSpan={c.colSpan}>{cell(c.text)}</th>)}</tr>)}</thead>
        )}
        <tbody>{t.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => c && (ci === 0 ? <th key={ci} scope="row" rowSpan={c.rowSpan} colSpan={c.colSpan}>{cell(c.text)}</th> : <td key={ci} rowSpan={c.rowSpan} colSpan={c.colSpan}>{cell(c.text)}</td>))}</tr>)}</tbody>
      </table>
    </div>
  );
}
