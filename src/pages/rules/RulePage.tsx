import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { appliesLabel, RuleRow, SourceNote, STATUS_WORD, VersionChip } from '../../components/rules/RuleBits';
import { currentVersion, fetchConflicts, fetchRevisions, officialLink, sameRuleElsewhere, type RuleEntry, type RulesIndex } from '../../data/rules';
import { useAsync } from '../../lib/useAsync';
import { useRules } from '../../lib/rules/useRules';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * One rule. Top to bottom: where it is (breadcrumb), whether it is in force, its number, title and words, then where it comes from (document,
 * version, page, official file), then its history (corrections, conflicts, other versions) and the rules around it.
 */
export function RulePage() {
  const { id = '' } = useParams();
  const { index, loading, error, reload } = useRules();
  const e = index?.entryById.get(id) ?? null;
  useDocumentTitle(e ? `${e.provision.number ? e.provision.number + ' ' : ''}${e.provision.title ?? e.doc.name}` : 'Rule');
  if (loading) return <section className="rl-page"><p className="src" role="status">Loading…</p></section>;
  if (error != null && !index) return <section className="rl-page"><div className="panel rule"><h3>The rules could not be loaded</h3><button type="button" className="btn btn-line" onClick={reload}>Try again</button></div></section>;
  if (!e || !index) return <section className="rl-page"><div className="panel rule"><h3>Rule not found</h3><p>It may belong to a version that is not published. <Link className="lnk" to="/rules">Back to rules</Link></p></div></section>;
  return <RuleView idx={index} e={e} key={e.id} />;
}

function RuleView({ idx, e }: { idx: RulesIndex; e: RuleEntry }) {
  const p = e.provision;
  const v = e.version;
  const cur = currentVersion(idx, e.doc.id);
  const elsewhere = sameRuleElsewhere(idx, p);
  const inCurrent = cur && cur.id !== v.id ? elsewhere.find(x => x.version.id === cur.id) : null;
  const revisions = useAsync(() => fetchRevisions(p.id), [p.id]);
  const conflicts = useAsync(() => fetchConflicts([v.id]), [v.id]);
  const mine = (conflicts.data ?? []).filter(c => c.provision_a === p.id || c.provision_b === p.id || (!c.provision_a && !c.provision_b));
  const link = officialLink(e.doc, v, p.page_from);
  const siblings = idx.byVersion.get(v.id) ?? [];
  const at = siblings.findIndex(x => x.id === p.id);
  const prev = at > 0 ? idx.entryById.get(siblings[at - 1].id) : undefined;
  const next = at >= 0 && at < siblings.length - 1 ? idx.entryById.get(siblings[at + 1].id) : undefined;
  const children = siblings.filter(x => x.parent_id === p.id).map(x => idx.entryById.get(x.id)!).filter(Boolean);
  const refs = p.cross_refs.map(n => siblings.find(x => x.number === n && x.kind !== 'appendix')).filter(Boolean).map(x => idx.entryById.get(x!.id)!).filter(Boolean);
  const pages = p.page_from ? (p.page_to && p.page_to !== p.page_from ? `pages ${p.page_from}–${p.page_to}` : `page ${p.page_from}`) : null;
  const [showOld, setShowOld] = useState<number | null>(null);

  return (
    <article className="fade-in rl-page rl-rule">
      <nav className="rl-crumbs" aria-label="Breadcrumb">
        <Link to="/rules">Rules</Link><span aria-hidden="true">›</span>
        <Link to={`/rules/doc/${e.doc.slug}${v.status !== 'published' ? `?v=${v.id}` : ''}`}>{e.doc.name}</Link>
        {e.ancestors.map(a => <span key={a.id} className="rl-crumb"><span aria-hidden="true">›</span><Link to={`/rules/r/${a.id}`}>{a.number ? `${a.number} ` : ''}{a.title ?? ''}</Link></span>)}
      </nav>

      {v.status === 'superseded' && (
        <p className="rl-banner" role="note"><b>Older version ({v.version}).</b> {inCurrent ? <>The wording in force is in {cur!.version}: <Link className="lnk" to={`/rules/r/${inCurrent.id}`}>open {inCurrent.provision.number ?? 'it'}</Link>.</> : cur ? <>This rule number is not in the version in force ({cur.version}).</> : null} Results decided under {v.version} keep this wording.</p>
      )}
      {v.status === 'withdrawn' && <p className="rl-banner" role="note"><b>Withdrawn version ({v.version}).</b> {v.withdrawn_reason}</p>}
      {(v.status === 'draft' || v.status === 'in_review') && <p className="rl-banner" role="note"><b>{STATUS_WORD[v.status]}.</b> Only the platform owner sees this until it is published.</p>}

      <header className="rl-rhead">
        {p.number && <span className="rl-bignum mono">{p.number}</span>}
        <h1>{p.title ?? (e.ancestors.length ? e.ancestors[e.ancestors.length - 1].title : null) ?? e.doc.name}</h1>
      </header>
      {p.body ? <div className="rl-body">{p.body}</div> : <p className="src">This heading has no text of its own; its rules are listed below.</p>}
      {p.review_status === 'needs_review' && <p className="rl-banner rl-warn" role="note"><b>Check the official document.</b> {p.review_note ?? 'This part could not be imported with confidence.'}</p>}

      <dl className="rl-meta">
        <div><dt>Source</dt><dd>{[e.doc.governing_body, e.doc.committee_name].filter(Boolean).join(' · ')}</dd></div>
        <div><dt>Document</dt><dd><Link className="lnk" to={`/rules/doc/${e.doc.slug}`}>{e.doc.name}</Link>{e.doc.synthetic && <span className="chip brass">Test data</span>}</dd></div>
        <div><dt>Version</dt><dd><VersionChip v={v} />{v.published_on && <span>dated {v.published_on}</span>}</dd></div>
        <div><dt>Where</dt><dd>{p.number ? `${p.kind === 'section' ? 'Section' : 'Rule'} ${p.number}` : 'Unnumbered'}{e.ancestors.length > 0 && <> in {e.ancestors.map(a => [a.number, a.title].filter(Boolean).join(' ')).join(' › ')}</>}{pages && <> · {pages}</>}</dd></div>
        <div><dt>Applies to</dt><dd>{appliesLabel(e.doc)}</dd></div>
        <div><dt>Checked</dt><dd>{p.review_status === 'verified' ? 'Compared with the official document by a person' : p.review_status === 'needs_review' ? 'Needs checking against the official document' : 'Imported from the official file; not yet compared line by line'}</dd></div>
      </dl>
      {link && <a className="btn btn-line rl-official" href={link} target="_blank" rel="noopener noreferrer">Open the official document{pages ? ` at ${pages}` : ''} ↗</a>}

      {(revisions.data?.length ?? 0) > 0 && (
        <section className="rl-block" aria-labelledby="rl-corr">
          <h2 id="rl-corr" className="rl-h2">Corrected in BuhurtOS</h2>
          <p className="src">The import of this rule was corrected after it was published. The earlier text is kept.</p>
          {revisions.data!.map(r => (
            <div key={r.id} className="rl-rev">
              <p><b>{r.changed_at.slice(0, 10)}</b> · {r.reason}</p>
              <button type="button" className="lnk" aria-expanded={showOld === r.id} onClick={() => setShowOld(showOld === r.id ? null : r.id)}>{showOld === r.id ? 'Hide' : 'Show'} the earlier text</button>
              {showOld === r.id && <div className="rl-body rl-oldbody">{r.before.body}</div>}
            </div>
          ))}
        </section>
      )}
      {mine.length > 0 && (
        <section className="rl-block" aria-labelledby="rl-conf">
          <h2 id="rl-conf" className="rl-h2">Recorded conflict</h2>
          {mine.map(c => <div key={c.id} className="rl-banner rl-warn"><p>{c.description}</p><p className="src">{c.status === 'open' ? 'Open: the official documents disagree; BuhurtOS has not decided which applies. Ask the head marshal.' : `Resolved: ${c.resolution}`}</p></div>)}
        </section>
      )}
      {children.length > 0 && <Rel title="In this section" list={children} />}
      {refs.length > 0 && <Rel title="Rules it refers to" list={refs} />}
      {elsewhere.length > 0 && (
        <section className="rl-block" aria-labelledby="rl-vers">
          <h2 id="rl-vers" className="rl-h2">This rule in other versions</h2>
          <div className="rl-list">{elsewhere.map(x => <RuleRow key={x.id} e={x} />)}</div>
        </section>
      )}
      <nav className="rl-prevnext" aria-label="Next and previous in the document">
        {prev ? <Link to={`/rules/r/${prev.id}`} className="btn btn-ghost">← {prev.provision.number ?? 'Previous'}</Link> : <span />}
        {next ? <Link to={`/rules/r/${next.id}`} className="btn btn-ghost">{next.provision.number ?? 'Next'} →</Link> : <span />}
      </nav>
      <SourceNote />
    </article>
  );
}

function Rel({ title, list }: { title: string; list: RuleEntry[] }) {
  return (
    <section className="rl-block">
      <h2 className="rl-h2">{title}</h2>
      <div className="rl-list">{list.map(x => <RuleRow key={x.id} e={x} showDoc={false} />)}</div>
    </section>
  );
}
