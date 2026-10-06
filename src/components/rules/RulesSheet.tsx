import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from '../Dialog';
import { Highlight, statusWords } from './RuleBits';
import { isRuleText, officialLink, type RuleEntry, type RulesIndex } from '../../data/rules';
import { RuleBody } from './RuleBody';
import { searchRules } from '../../lib/rules/search';
import { useRules } from '../../lib/rules/useRules';
import { useSampleMode } from '../../data/mode';

/** The rules an official can cite or look up during a fight: the versions in force (test rulesets only in sample mode). */
export function officiatingEntries(idx: RulesIndex | null, sample: boolean): RuleEntry[] {
  return (idx?.entries ?? []).filter(e => e.version.status === 'published' && (sample || !e.doc.synthetic) && e.provision.kind !== 'section' && e.provision.kind !== 'part' && isRuleText(e.provision));
}

/** Search box + results, used by the rules sheet and the rule picker. */
function useRuleSearch() {
  const { index, loading } = useRules();
  const sample = useSampleMode();
  const entries = useMemo(() => officiatingEntries(index, sample), [index, sample]);
  const [q, setQ] = useState('');
  const res = useMemo(() => (q.trim() ? searchRules(entries, q, 12) : null), [entries, q]);
  return { index, loading, entries, q, setQ, res };
}

function SearchBox({ q, setQ, label }: { q: string; setQ: (s: string) => void; label: string }) {
  return (
    <label className="rulesearch">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ color: 'var(--faint)', flex: 'none' }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input type="search" enterKeyHint="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Words or a rule number" aria-label={label} autoComplete="off" autoCorrect="off" spellCheck={false} />
    </label>
  );
}

/**
 * Look up a rule without leaving the fight: search, open one, read it, go back. The clock and the fight keep running underneath; nothing here
 * changes the match.
 */
export function RulesSheet({ onClose }: { onClose: () => void }) {
  const { loading, entries, q, setQ, res } = useRuleSearch();
  const [open, setOpen] = useState<RuleEntry | null>(null);
  return (
    <Dialog title={open ? `${open.provision.number ? open.provision.number + ' · ' : ''}${open.doc.name}` : 'Rules'} variant="drawer" onClose={onClose}>
      <div className="rl-sheet">
        {open ? (
          <>
            <button type="button" className="btn btn-line" onClick={() => setOpen(null)}>← Back to results</button>
            <h3>{open.provision.title ?? open.doc.name}</h3>
            <RuleBody body={open.provision.body} />
            {open.provision.has_figures && <p className="src">The official page also has pictures: open the official document to see them.</p>}
            <p className="src">{open.doc.name} · {open.version.version} ({statusWords(open.version)}){open.provision.page_from ? ` · page ${open.provision.page_from}` : ''}{open.ancestors.length ? ` · in ${open.ancestors.map(a => a.number ?? a.title).join(' › ')}` : ''}</p>
            {open.provision.review_status === 'needs_review' && <p className="rl-banner rl-warn">Check the official document: {open.provision.review_note}</p>}
            <div className="rl-picked">
              <Link className="lnk" to={`/rules/r/${open.provision.id}`} target="_blank" rel="noopener">Open the full rule page ↗</Link>
              {officialLink(open.doc, open.version, open.provision.page_from) && <a className="lnk" href={officialLink(open.doc, open.version, open.provision.page_from)!} target="_blank" rel="noopener noreferrer">Official document ↗</a>}
            </div>
          </>
        ) : (
          <>
            <SearchBox q={q} setQ={setQ} label="Search the rules" />
            {loading && <p className="src" role="status">Loading the rules…</p>}
            {!loading && entries.length === 0 && <p className="src" role="status">The official rule text is not in BuhurtOS yet. Use the paper rulebook, or <Link className="lnk" to="/rules" target="_blank" rel="noopener">open Rules</Link> for the summaries and the official documents.</p>}
            {res && (res.hits.length ? (
              <div className="rl-list" aria-live="polite">
                {res.partial && <p className="src">Closest matches:</p>}
                {res.hits.map(h => (
                  <button key={h.item.id} type="button" className="rl-pickrow" onClick={() => setOpen(h.item)}>
                    <span className="rl-num mono">{h.item.provision.number ?? '·'}</span>
                    <span className="rl-main"><span className="rl-doc">{h.item.doc.name}</span><b className="rl-title"><Highlight text={h.item.provision.title ?? ''} matched={h.matched} /></b><span className="rl-snip"><Highlight text={h.snippet} matched={h.matched} /></span></span>
                  </button>))}
              </div>) : <p className="rl-none" role="status">No rule matches “{q.trim()}”.</p>)}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Choose the rule a marshal's call was for (optional). Shows nothing when no official rule text is available. */
export function RulePicker({ value, onChange, startOpen = false }: { value: string | null; onChange: (id: string | null) => void; startOpen?: boolean }) {
  const { index, entries, q, setQ, res } = useRuleSearch();
  const [searching, setSearching] = useState(startOpen);
  const picked = value ? index?.entryById.get(value) ?? null : null;
  if (!entries.length && !picked) return null;
  if (picked && !searching) {
    return (
      <div className="rl-picked">
        <span className="chip steel">{picked.provision.number ? `${picked.provision.number} · ` : ''}{picked.provision.title ?? picked.doc.name} · {picked.doc.name}</span>
        <button type="button" className="btn btn-line btn-sm" onClick={() => setSearching(true)}>Change</button>
        <button type="button" className="btn btn-line btn-sm" onClick={() => onChange(null)}>Remove</button>
      </div>
    );
  }
  if (!searching && !picked) return <button type="button" className="btn btn-line btn-sm" onClick={() => setSearching(true)}>Add the rule (optional)</button>;
  return (
    <div className="rl-pick">
      <SearchBox q={q} setQ={setQ} label="Find the rule" />
      {res && (res.hits.length ? res.hits.slice(0, 6).map(h => (
        <button key={h.item.id} type="button" className="rl-pickrow" aria-pressed={value === h.item.id} onClick={() => { onChange(h.item.id); setSearching(false); setQ(''); }}>
          <span className="rl-num mono">{h.item.provision.number ?? '·'}</span>
          <span className="rl-main"><span className="rl-doc">{h.item.doc.name}</span><b className="rl-title"><Highlight text={h.item.provision.title ?? h.snippet} matched={h.matched} /></b></span>
        </button>)) : <p className="rl-none">No rule matches “{q.trim()}”.</p>)}
      <button type="button" className="lnk" onClick={() => { setSearching(false); setQ(''); }}>Cancel</button>
    </div>
  );
}

/** "Rule 2.1 · Prohibited targets" for a cited provision, or null. */
export function citationLabel(idx: RulesIndex | null, provisionId: string | null | undefined): string | null {
  if (!provisionId) return null;
  const e = idx?.entryById.get(provisionId);
  return e ? `${e.provision.number ? `Rule ${e.provision.number}` : 'Rule'}${e.provision.title ? ` · ${e.provision.title}` : ''} (${e.doc.name} ${e.version.version}${e.version.historical ? ', earlier edition, not in force' : e.version.status === 'superseded' ? ', older version' : ''})` : 'A rule (not available on this device)';
}
