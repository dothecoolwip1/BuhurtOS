import { Link } from 'react-router-dom';
import { highlightParts } from '../../lib/rules/search';
import type { RuleDocument, RuleEntry, RuleVersion } from '../../data/rules';

export function Highlight({ text, matched }: { text: string; matched: string[] }) {
  return <>{highlightParts(text, matched).map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

export const FORMAT_LABEL: Record<string, string> = { buhurt: 'Group fight', duels: 'Duels', outrance: 'Profight', hacsa: 'HACSA' };
export const appliesLabel = (doc: RuleDocument) => (doc.applies_to.length ? doc.applies_to.map(a => FORMAT_LABEL[a] ?? a).join(' · ') : 'All formats');

export const STATUS_WORD: Record<RuleVersion['status'], string> = { published: 'In force', superseded: 'Older version', withdrawn: 'Withdrawn', in_review: 'In review (not published)', draft: 'Draft (not published)' };
export function VersionChip({ v }: { v: RuleVersion }) {
  const tone = v.status === 'published' ? 'win' : v.status === 'superseded' || v.status === 'withdrawn' ? 'old' : 'brass';
  return <span className={`chip ${tone}`}>{v.version} · {STATUS_WORD[v.status]}</span>;
}

/** One search result or list row: the number first and big, then the document, then the title and a short piece of the text. */
export function RuleRow({ e, matched = [], snippet, showDoc = true, to }: { e: RuleEntry; matched?: string[]; snippet?: string; showDoc?: boolean; to?: string }) {
  const p = e.provision;
  return (
    <Link className="rl-row" to={to ?? `/rules/r/${p.id}`}>
      <span className="rl-num mono">{p.number ?? '·'}</span>
      <span className="rl-main">
        {showDoc && <span className="rl-doc">{e.doc.name} · {e.version.version}{e.version.status !== 'published' ? ` · ${STATUS_WORD[e.version.status]}` : ''}</span>}
        <b className="rl-title">{p.title ? <Highlight text={p.title} matched={matched} /> : (e.ancestors.length ? e.ancestors[e.ancestors.length - 1].title ?? 'Rule' : 'Rule')}</b>
        {(snippet ?? p.body) && <span className="rl-snip"><Highlight text={snippet ?? p.body.slice(0, 160)} matched={matched} /></span>}
      </span>
    </Link>
  );
}

export function SourceNote() {
  return (
    <p className="src rl-attrib">
      The rules belong to their governing body (Buhurt International for the official documents listed here). BuhurtOS is not a governing body and did not write them:
      always follow the official document and the event's own regulations. Each rule shows its document, version and page so you can check it.
    </p>
  );
}
