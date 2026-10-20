import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Seg } from '../components/ui';
import { Highlight, RuleRow, SourceNote } from '../components/rules/RuleBits';
import { currentVersion, inSearchScope, isHistorical, isRuleText, summaryEntries, type RuleDocument, type RulesIndex } from '../data/rules';
import { searchRules } from '../lib/rules/search';
import { useRules } from '../lib/rules/useRules';
import { useSampleMode } from '../data/mode';
import { useTrackSearch } from '../lib/useTrackSearch';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type F = 'all' | 'buhurt' | 'duels' | 'outrance';
const FORMATS: readonly (readonly [F, string])[] = [['all', 'All'], ['buhurt', 'Group fight'], ['duels', 'Duels'], ['outrance', 'Profight']];
/** Shortcuts for questions asked at the side of the list: each just runs a search (BuhurtOS shortcuts, not official categories). */
const QUICK: readonly (readonly [string, string])[] = [
  ['Cards and penalties', 'card'], ['Green card', 'green card'], ['Grounded fighter', 'striking grounded fighter'], ['Strike zones', 'strike zones'],
  ['Back of the knee', 'back of knee'], ['Appeals', 'appeal'], ['Authenticity infractions', 'infraction'], ['Weapon weights', 'weight length blade'],
  ['Marshal accreditation', 'marshal accreditation']
];
const SUMMARY_WORD: Record<Exclude<F, 'all'>, string> = { buhurt: 'Group fight', duels: 'Duels', outrance: 'Profight' };
/** Official matches shown before "Show all": enough to answer most questions at the list without burying the summaries. */
const FIRST = 5;

/** Moves to a section heading (scrolled and focused), without touching the address, so Back still leaves the search as it was. */
function JumpTo({ target, children }: { target: string; children: ReactNode }) {
  return (
    <button type="button" className="btn btn-line rl-jump" onClick={() => {
      const el = document.getElementById(target);
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    }}>{children} ↓</button>
  );
}

/** A document applies to a format when it names it, or names none (general documents apply to every format). */
const docFits = (d: RuleDocument, f: F) => f === 'all' || d.applies_to.length === 0 || d.applies_to.includes(f);

/**
 * Rules: one search box for the side of the list. Official rule text (imported from the governing body's documents, with document, version and
 * page) comes first; BuhurtOS's own short summaries come after and are labelled as summaries. With no search, the official documents are listed
 * by committee, each opening its text in BuhurtOS when imported and always linking to the official file.
 */
export function RulesPage() {
  useDocumentTitle('Rules');
  const [params, setParams] = useSearchParams();
  // What is typed and ticked lives here first (so fast typing never waits for the address bar), and is mirrored into the address for sharing / back.
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [older, setOlder] = useState(() => params.get('old') === '1');
  useTrackSearch('rules', q);
  const rawF = params.get('f') ?? params.get('g');
  const [f, setF] = useState<F>(() => (FORMATS.some(([k]) => k === rawF) ? (rawF as F) : 'all'));
  // Back / forward are followed (the address is the only thing that changed then); typing never reads the address back, so no keystroke is lost.
  useEffect(() => {
    const follow = () => {
      const u = new URLSearchParams(window.location.search);
      setQ(u.get('q') ?? ''); setOlder(u.get('old') === '1');
      const uf = u.get('f') ?? u.get('g'); setF(FORMATS.some(([k]) => k === uf) ? (uf as F) : 'all');
    };
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);
  const sample = useSampleMode();
  const { index, loading, error, stale, reload } = useRules();
  const set = (next: { q?: string; f?: F; old?: boolean }) => {
    if (next.q !== undefined) setQ(next.q);
    if (next.old !== undefined) setOlder(next.old);
    if (next.f !== undefined) setF(next.f);
    const p = new URLSearchParams(window.location.search);
    p.delete('g');
    if (next.q !== undefined) { if (next.q) p.set('q', next.q); else p.delete('q'); }
    if (next.f !== undefined) { if (next.f !== 'all') p.set('f', next.f); else p.delete('f'); }
    if (next.old !== undefined) { if (next.old) p.set('old', '1'); else p.delete('old'); }
    setParams(p, { replace: true });
  };
  // Test rulesets show only in sample mode, like other test data.
  const docs = useMemo(() => (index?.data.documents ?? []).filter(d => (sample || !d.synthetic) && docFits(d, f)), [index, sample, f]);
  const official = useMemo(() => (index?.entries ?? []).filter(e => isRuleText(e.provision) && (sample || !e.doc.synthetic) && docFits(e.doc, f) && inSearchScope(e.version, older)), [index, sample, f, older]);
  const summaries = useMemo(() => summaryEntries(index?.data.documents ?? []).filter(s => f === 'all' || s.summary.kind.includes(SUMMARY_WORD[f]) || /All formats|Tournaments/.test(s.summary.kind)), [index, f]);
  const needle = q.trim();
  const res = useMemo(() => (needle ? searchRules(official, needle, 80) : null), [official, needle]);
  const sres = useMemo(() => (needle ? searchRules(summaries, needle, 20) : null), [summaries, needle]);
  const textCount = useMemo(() => new Set(official.map(e => e.version.id)).size, [official]);
  const anyOlder = (index?.data.versions ?? []).some(v => v.status === 'superseded' || v.status === 'withdrawn' || isHistorical(v));
  // "Show all" belongs to one search: a new word, format or version scope starts again at the best few.
  const scope = `${needle}|${f}|${older ? 1 : 0}`;
  const [allFor, setAllFor] = useState<string | null>(null);
  const showAll = allFor === scope;
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const total = res?.hits.length ?? 0;
  const shown = res ? (showAll ? res.hits : res.hits.slice(0, FIRST)) : [];
  const toggleAll = () => {
    const next = !showAll;
    setAllFor(next ? scope : null);
    requestAnimationFrame(() => {
      // Opening: continue from the first newly shown rule. Closing: stay on the button, brought back into view.
      if (next) listRef.current?.querySelectorAll<HTMLElement>('.rl-row')[FIRST]?.focus();
      else moreRef.current?.scrollIntoView({ block: 'nearest' });
    });
  };

  return (
    <section className="fade-in rl-page">
      <div className="rl-head">
        <p className="eyebrow">Rules</p>
        <h1>Find a rule</h1>
      </div>
      <form className="rl-search" role="search" onSubmit={e => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }}>
        <label className="rulesearch">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ color: 'var(--faint)', flex: 'none' }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" enterKeyHint="search" value={q} onChange={e => set({ q: e.target.value })} placeholder="Words or a rule number, e.g. “helmet”, “4.2”" aria-label="Search rules" autoComplete="off" autoCorrect="off" spellCheck={false} />
          {q && <button type="button" className="rl-clear" onClick={() => set({ q: '' })} aria-label="Clear search">×</button>}
        </label>
      </form>
      <div className="rl-filters">
        <Seg label="Format" value={f} options={FORMATS} onChange={x => set({ f: x })} scroll />
        {anyOlder && <label className="rl-check"><input type="checkbox" checked={older} onChange={e => set({ old: e.target.checked })} /> Include older versions and earlier editions</label>}
      </div>
      {!needle && textCount > 0 && (
        <div className="rl-quick" role="group" aria-label="Common questions">
          {QUICK.map(([label, query]) => <button key={label} type="button" className="chip rl-qchip" onClick={() => set({ q: query })}>{label}</button>)}
        </div>
      )}
      {!needle && summaries.length > 0 && <div className="rl-more"><JumpTo target="rl-quick">Quick summaries</JumpTo></div>}
      {stale && <p className="src" role="status">Showing the rules saved on this device; they could not be refreshed just now.</p>}
      {error != null && !index && <div className="panel rule"><h3>The rules could not be loaded</h3><p>Check the connection and try again.</p><button type="button" className="btn btn-line" onClick={reload}>Try again</button></div>}
      {loading && <p className="src" role="status">Loading the rules…</p>}

      {res && (
        <div className="rl-results" aria-live="polite">
          {textCount > 0 && (
            <section className="rl-block" aria-labelledby="rl-official">
              <h2 id="rl-official" className="rl-h2">Official rules <span className="mono">{total}{total === 80 ? '+' : ''}</span></h2>
              {res.partial && <p className="src">No rule has every word you typed. These are the closest.</p>}
              {total > FIRST && <p className="src">{showAll ? `All ${total} matches, best first.` : `The ${FIRST} best of ${total}${total === 80 ? '+' : ''} matches.`}</p>}
              {total ? <div className="rl-list" id="rl-official-list" ref={listRef}>{shown.map(h => <RuleRow key={h.item.id} e={h.item} matched={h.matched} snippet={h.snippet} />)}</div>
                : <p className="rl-none">No official rule matches “{needle}”.</p>}
              {(total > FIRST || (sres?.hits.length ?? 0) > 0) && (
                <div className="rl-more">
                  {total > FIRST && <button ref={moreRef} type="button" className="btn btn-line" aria-expanded={showAll} aria-controls="rl-official-list" onClick={toggleAll}>
                    {showAll ? 'Show fewer' : total === 80 ? 'Show the top 80' : `Show all ${total}`}</button>}
                  {(sres?.hits.length ?? 0) > 0 && <JumpTo target="rl-sum">{sres!.hits.length} BuhurtOS summar{sres!.hits.length === 1 ? 'y' : 'ies'}</JumpTo>}
                </div>
              )}
            </section>
          )}
          <section className="rl-block" aria-labelledby="rl-sum">
            <h2 id="rl-sum" className="rl-h2" tabIndex={-1}>BuhurtOS summaries <span className="mono">{sres?.hits.length ?? 0}</span></h2>
            <p className="src">Short paraphrases written by BuhurtOS, not the official wording. Check the source shown on each.</p>
            {sres && sres.hits.length > 0 && <div className="rl-list">{sres.hits.map(h => (
              <article className="panel rule rl-summary" key={h.item.id}>
                <div className="rt"><span className="eyebrow">{h.item.summary.kind} · summary</span><span className="chip steel">{h.item.summary.doc} · {h.item.summary.section}</span></div>
                <h3><Highlight text={h.item.title ?? ''} matched={h.matched} /></h3>
                <p><Highlight text={h.item.body} matched={h.matched} /></p>
                {h.item.docs.length > 0 && <p className="src">Official document: {h.item.docs.map((d, i) => <span key={d.id}>{i ? ' · ' : ''}<Link className="lnk" to={`/rules/doc/${d.slug}`}>{d.name}</Link></span>)}</p>}
              </article>))}</div>}
          </section>
          {!res.hits.length && !sres?.hits.length && (
            <div className="panel rule" role="status">
              <h3>Nothing matches “{needle}”</h3>
              <p>Try one word, a different word for the same thing, or a rule number. {f !== 'all' && <>The format filter is on: <button type="button" className="lnk" onClick={() => set({ f: 'all' })}>search all formats</button>.</>}</p>
              <p>The official documents are always listed below the search when it is empty.</p>
            </div>
          )}
        </div>
      )}

      {!needle && index && <Browse idx={index} docs={docs} textCount={textCount} />}
      {!needle && <Summaries list={summaries} />}
      <SourceNote />
    </section>
  );
}

function Browse({ idx, docs, textCount }: { idx: RulesIndex; docs: RuleDocument[]; textCount: number }) {
  const byKey = new Map<string, { name: string; docs: RuleDocument[]; first: number; bout: boolean }>();
  for (const d of docs) {
    const k = `${d.governing_body ?? 'Other'}|${d.committee ?? ''}`;
    if (!byKey.has(k)) byKey.set(k, { name: [d.governing_body, d.committee_name].filter(Boolean).join(' · ') || 'Other documents', docs: [], first: Infinity, bout: false });
    const g = byKey.get(k)!;
    g.docs.push(d); g.first = Math.min(g.first, d.page_order ?? Infinity); g.bout ||= d.kind === 'rules';
  }
  // The order of the governing body's own page; the committee that publishes the bout rules opens first (what is needed at the list).
  const sorted = [...byKey.values()].sort((a, b) => a.first - b.first || a.name.localeCompare(b.name));
  sorted.forEach(g => g.docs.sort((a, b) => (a.page_order ?? 0) - (b.page_order ?? 0)));
  const groups = new Map(sorted.map(g => [g.name, g]));
  const openFirst = sorted.find(g => g.bout)?.name ?? sorted[0]?.name;
  return (
    <section className="rl-block" aria-labelledby="rl-docs">
      <h2 id="rl-docs" className="rl-h2">Official documents</h2>
      {textCount === 0 && <p className="src rl-notice">The official rule text is not published in BuhurtOS yet, so search covers the BuhurtOS summaries only. Every official document is listed here and opens on the governing body's own site.</p>}
      <div className="rl-groups">
        {[...groups.values()].map(g => (
          <details key={g.name} className="rl-group" open={g.name === openFirst || groups.size <= 2}>
            <summary><span>{g.name}</span><span className="mono rl-count">{g.docs.filter(d => d.source_host !== 'drive_folder').length}</span></summary>
            <ul className="rl-doclist">
              {g.docs.map(d => {
                const v = currentVersion(idx, d.id);
                const earlier = (idx.versionsByDoc.get(d.id) ?? []).filter(isHistorical).length;
                const folder = d.source_host === 'drive_folder';
                return (
                  <li key={d.id}>
                    {folder
                      ? <a className="rl-docrow" href={d.official_url ?? '#'} target="_blank" rel="noopener noreferrer"><span><b>{d.name}</b>{d.heading && <span className="rl-sub">{d.heading}</span>}</span><span className="chip">Earlier versions ↗</span></a>
                      : <Link className="rl-docrow" to={`/rules/doc/${d.slug}`}><span><b>{d.name}</b>{d.heading && <span className="rl-sub">{d.heading}</span>}</span><span className="rl-docchips">{v ? <span className="chip win">Text · {v.version}</span> : <span className="chip">Official file</span>}{earlier > 0 && <span className="chip old">{earlier} earlier edition{earlier === 1 ? '' : 's'}</span>}</span></Link>}
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}

function Summaries({ list }: { list: ReturnType<typeof summaryEntries> }) {
  if (!list.length) return null;
  return (
    <section className="rl-block" aria-labelledby="rl-quick">
      <h2 id="rl-quick" className="rl-h2" tabIndex={-1}>Quick summaries</h2>
      <p className="src">Short paraphrases written by BuhurtOS, not the official wording. Each names the document and section it summarizes.</p>
      <div className="rl-groups">
        {list.map(s => (
          <details key={s.id} className="rl-group rl-sumitem">
            <summary><span>{s.title}</span><span className="rl-sub">{s.summary.kind}</span></summary>
            <div className="rl-sumbody">
              <p>{s.body}</p>
              <p className="src">{s.summary.doc} · {s.summary.section}{s.docs.length > 0 && <> · {s.docs.map((d, i) => <span key={d.id}>{i ? ', ' : ''}<Link className="lnk" to={`/rules/doc/${d.slug}`}>{d.name}</Link></span>)}</>}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
