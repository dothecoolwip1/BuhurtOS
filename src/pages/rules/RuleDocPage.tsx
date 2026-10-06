import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { appliesLabel, RuleRow, SourceNote, VersionChip } from '../../components/rules/RuleBits';
import { officialLink, type RuleEntry } from '../../data/rules';
import { searchRules } from '../../lib/rules/search';
import { useRules } from '../../lib/rules/useRules';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * One official document: what it is, who issued it, the official file, its versions, and (when imported) its contents in reading order with a
 * search inside it. An older version opens with ?v=<version id>; it stays readable for everything decided under it.
 */
export function RuleDocPage() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { index, loading, error, reload } = useRules();
  const [q, setQ] = useState('');
  const doc = index?.docBySlug.get(slug) ?? null;
  useDocumentTitle(doc ? doc.name : 'Rules');
  const versions = doc ? index!.versionsByDoc.get(doc.id) ?? [] : [];
  const picked = params.get('v');
  const version = versions.find(v => v.id === picked) ?? versions.find(v => v.status === 'published') ?? versions[0] ?? null;
  const entries = useMemo(() => (index && version ? (index.byVersion.get(version.id) ?? []).map(p => index.entryById.get(p.id)!).filter(Boolean) : []), [index, version]);
  const res = useMemo(() => (q.trim() ? searchRules(entries, q, 100) : null), [entries, q]);

  if (loading) return <section className="rl-page"><p className="src" role="status">Loading…</p></section>;
  if (error != null && !index) return <section className="rl-page"><div className="panel rule"><h3>The rules could not be loaded</h3><button type="button" className="btn btn-line" onClick={reload}>Try again</button></div></section>;
  if (!doc) return <section className="rl-page"><div className="panel rule"><h3>Document not found</h3><p><Link className="lnk" to="/rules">Back to rules</Link></p></div></section>;
  const link = officialLink(doc, version, null);

  return (
    <section className="fade-in rl-page">
      <nav className="rl-crumbs" aria-label="Breadcrumb"><Link to="/rules">Rules</Link><span aria-hidden="true">›</span><span>{doc.committee_name ?? doc.governing_body}</span></nav>
      <div className="rl-head">
        <p className="eyebrow">{doc.governing_body}{doc.synthetic ? ' · TEST DATA' : ''}</p>
        <h1>{doc.name}</h1>
        {doc.heading && <p className="rl-sub">{doc.heading}</p>}
      </div>
      <dl className="rl-meta">
        <div><dt>Issued by</dt><dd>{[doc.governing_body, doc.committee_name].filter(Boolean).join(' · ')}</dd></div>
        <div><dt>Applies to</dt><dd>{appliesLabel(doc)} <span className="src">(BuhurtOS reading of the title)</span></dd></div>
        {version && <div><dt>Version</dt><dd><VersionChip v={version} />{version.published_on && <span>dated {version.published_on}</span>}</dd></div>}
        {!doc.listed_on_page && <div><dt>Listing</dt><dd>No longer listed on the official rules page</dd></div>}
      </dl>
      {link && <a className="btn btn-line rl-official" href={link} target="_blank" rel="noopener noreferrer">Open the official document ↗</a>}

      {versions.length > 1 && (
        <div className="rl-versions" role="group" aria-label="Versions">
          {versions.map(v => <button key={v.id} type="button" className="rl-vbtn" aria-pressed={v.id === version?.id} onClick={() => { const p = new URLSearchParams(params); p.set('v', v.id); setParams(p, { replace: true }); }}><VersionChip v={v} /></button>)}
        </div>
      )}
      {version && version.status === 'superseded' && <p className="rl-banner">This is an older version. {(() => { const cur = versions.find(v => v.status === 'published'); return cur ? <button type="button" className="lnk" onClick={() => { const p = new URLSearchParams(params); p.set('v', cur.id); setParams(p, { replace: true }); }}>Open the version in force ({cur.version})</button> : null; })()}</p>}
      {version && version.status === 'withdrawn' && <p className="rl-banner">Withdrawn: {version.withdrawn_reason}</p>}
      {version && (version.status === 'draft' || version.status === 'in_review') && <p className="rl-banner">Not published: visible to the platform owner only, for review.</p>}

      {!version && (
        <div className="panel rule rl-notext">
          <h3>The text is not in BuhurtOS yet</h3>
          <p>Read this document on {doc.governing_body ?? 'the governing body'}'s site. BuhurtOS will show its rules here, with their numbers and pages, once the official file has been imported and checked.</p>
          {doc.previously_cited_as && <p className="src">Earlier BuhurtOS summaries quote it as “{doc.previously_cited_as}”; that may not be the version linked today.</p>}
        </div>
      )}

      {version && entries.length > 0 && (
        <>
          <label className="rulesearch rl-insearch">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ color: 'var(--faint)', flex: 'none' }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" enterKeyHint="search" value={q} onChange={e => setQ(e.target.value)} placeholder={`Search in ${doc.name}`} aria-label={`Search in ${doc.name}`} autoComplete="off" />
          </label>
          {res ? (
            <div className="rl-list" aria-live="polite">{res.hits.length ? res.hits.map(h => <RuleRow key={h.item.id} e={h.item} matched={h.matched} snippet={h.snippet} showDoc={false} />) : <p className="rl-none">Nothing in this document matches “{q.trim()}”.</p>}</div>
          ) : <Contents entries={entries} />}
        </>
      )}
      {version && <p className="src">Imported {version.imported_at?.slice(0, 10) ?? '—'} from the official file{version.page_count ? ` (${version.page_count} pages)` : ''}{version.source_sha256 ? `, checksum ${version.source_sha256.slice(0, 12)}…` : ''}.</p>}
      <SourceNote />
    </section>
  );
}

/** The document in reading order: sections as headings, rules as rows under them. */
function Contents({ entries }: { entries: RuleEntry[] }) {
  return (
    <ol className="rl-toc">
      {entries.map(e => {
        const p = e.provision;
        const heading = p.kind === 'section' || p.kind === 'part' || p.kind === 'appendix';
        return (
          <li key={p.id} className={heading ? 'rl-toc-h' : ''} style={{ paddingLeft: Math.min(p.depth, 4) * 12 }}>
            <Link to={`/rules/r/${p.id}`}>
              <span className="rl-num mono">{p.number ?? '·'}</span>
              <span className="rl-tt">{p.title ?? (p.kind === 'figure' && !p.body ? ((p.topics ?? []).includes('cover') ? 'Cover page (pictures only)' : `Page ${p.page_from ?? ''}: pictures only`) : e.body ? e.body.slice(0, 90) + (e.body.length > 90 ? '…' : '') : 'Untitled')}</span>
              {(p.topics ?? []).includes('changelog') && <span className="chip">Change log</span>}
              {p.review_status === 'needs_review' && <span className="chip brass">Check</span>}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
