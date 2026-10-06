import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHead } from '../../components/ui';
import { Dialog } from '../../components/Dialog';
import { SuspensionAdmin } from '../../components/discipline/SuspensionAdmin';
import { clearRulesCache, refreshRules } from '../../data/rules';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PlatformGate } from './PlatformPages';

interface Waiting {
  id: string; version: string; status: 'draft' | 'in_review'; import_release: string | null; page_count: number | null; note: string | null;
  doc: { name: string; slug: string; committee_name: string | null; governing_body: string | null; synthetic: boolean };
  provisions: number; needsReview: number; reconciled: boolean; coverage: number | null; ocrCorrections: number; pictureText: number;
}

async function fetchWaiting(): Promise<Waiting[]> {
  const v = await supabase.from('ruleset_versions').select('id, version, status, import_release, page_count, note, reconciliation, rulesets(name, slug, committee_name, governing_body, synthetic, page_order)')
    .in('status', ['draft', 'in_review']);
  if (v.error) throw v.error;
  type Row = { id: string; version: string; status: 'draft' | 'in_review'; import_release: string | null; page_count: number | null; note: string | null; reconciliation: Record<string, unknown> | null;
    rulesets: { name: string; slug: string; committee_name: string | null; governing_body: string | null; synthetic: boolean; page_order: number | null } };
  const rows = (v.data ?? []) as unknown as Row[];
  const counts = new Map<string, { n: number; open: number }>();
  if (rows.length) {
    for (let from = 0; ; from += 1000) {
      const p = await supabase.from('rule_provisions').select('ruleset_version_id, review_status').in('ruleset_version_id', rows.map(r => r.id)).range(from, from + 999);
      if (p.error) throw p.error;
      for (const x of (p.data ?? []) as { ruleset_version_id: string; review_status: string }[]) {
        const c = counts.get(x.ruleset_version_id) ?? { n: 0, open: 0 };
        c.n++; if (x.review_status === 'needs_review') c.open++;
        counts.set(x.ruleset_version_id, c);
      }
      if (!p.data || p.data.length < 1000) break;
    }
  }
  return rows.map(r => ({
    id: r.id, version: r.version, status: r.status, import_release: r.import_release, page_count: r.page_count, note: r.note,
    doc: { name: r.rulesets.name, slug: r.rulesets.slug, committee_name: r.rulesets.committee_name, governing_body: r.rulesets.governing_body, synthetic: r.rulesets.synthetic },
    provisions: counts.get(r.id)?.n ?? 0, needsReview: counts.get(r.id)?.open ?? 0, reconciled: r.reconciliation?.ok === true,
    coverage: typeof r.reconciliation?.char_coverage === 'number' ? (r.reconciliation.char_coverage as number) : null,
    ocrCorrections: Number(r.reconciliation?.ocr_corrections ?? 0), pictureText: Number(r.reconciliation?.picture_text_lines ?? 0)
  })).sort((a, b) => (a.doc.governing_body ?? '').localeCompare(b.doc.governing_body ?? '') || (a.doc.committee_name ?? '').localeCompare(b.doc.committee_name ?? '') || a.doc.name.localeCompare(b.doc.name));
}
const ready = (w: Waiting) => w.status === 'in_review' && w.reconciled && w.needsReview === 0 && w.provisions > 0;

/**
 * Pack 22: the platform owner's rules desk. Imported official documents wait "in review" until the owner publishes them; publishing makes them the
 * version in force (the previous one becomes "older version", never deleted) and the database refuses a version that did not reconcile or still has
 * provisions to check. Also the platform's own suspensions (for example a permanent ban the governing body decided).
 */
export function PlatformRulesPage() {
  useDocumentTitle('Rules · Platform');
  return (
    <PlatformGate>
      <section className="plat" style={{ display: 'grid', gap: 22 }}>
        <PageHead eyebrow="Platform" title="Rules and suspensions" lede="Publish imported official documents, and record suspensions that apply to every event." />
        <Publish />
        <SuspensionAdmin organizationId={null} title="Platform suspensions" />
      </section>
    </PlatformGate>
  );
}

function Publish() {
  const [tick, setTick] = useState(0);
  const list = useAsync(fetchWaiting, [], [tick]);
  const [confirm, setConfirm] = useState<Waiting[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rows = list.data ?? [];
  const okRows = useMemo(() => rows.filter(ready), [rows]);
  const publish = async (items: Waiting[]) => {
    setBusy(true); setErr(null); setDone(null);
    let n = 0;
    try {
      for (const w of items) {
        const { error } = await supabase.rpc('publish_ruleset_version', { p_version: w.id, p_note: `Published from the platform rules desk (release ${w.import_release ?? '—'})` });
        if (error) throw Object.assign(error, { message: `${w.doc.name} ${w.version}: ${error.message}` });
        n++;
      }
      setDone(`Published ${n} version${n === 1 ? '' : 's'}.`);
    } catch (e) { setErr(`${n ? `Published ${n}, then stopped. ` : ''}${friendlyError(e, 'Could not publish.')}`); }
    finally { setBusy(false); setConfirm(null); setTick(t => t + 1); clearRulesCache(); void refreshRules().catch(() => undefined); }
  };
  return (
    <section className="dd-panel" aria-labelledby="pr-pub">
      <div className="dd-head">
        <h2 id="pr-pub" className="rl-h2">Waiting to be published <span className="mono">{rows.length}</span></h2>
        {okRows.length > 1 && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => setConfirm(okRows)}>Publish all {okRows.length} ready</button>}
      </div>
      <p className="src">Each version was imported from the official file and reconciled line by line (see <code>rules-library/…/reconciliation.md</code> in the repository). Open one to read it before publishing; drafts and versions in review are visible to you only.</p>
      {done && <p role="status" className="rl-banner">{done}</p>}
      {err && <p role="alert" className="dd-err">{err}</p>}
      {list.loading && !list.data && <p className="src" role="status">Loading…</p>}
      {list.error != null && <p role="alert">{friendlyError(list.error, 'Could not load the versions.')}</p>}
      {list.data && rows.length === 0 && <p className="rl-none">Nothing is waiting. Every imported version is published.</p>}
      <ul className="dd-list">
        {rows.map(w => (
          <li key={w.id}>
            <span className="dd-what"><b><Link className="lnk" to={`/rules/doc/${w.doc.slug}?v=${w.id}`}>{w.doc.name}</Link></b> · {w.version}{w.doc.synthetic ? ' · test data' : ''}
              {ready(w) ? <span className="chip win">Ready</span> : <span className="chip brass">{w.status === 'draft' ? 'Draft: did not reconcile' : w.needsReview ? `${w.needsReview} to check` : 'Not ready'}</span>}</span>
            <span className="dl-where">{[w.doc.governing_body, w.doc.committee_name].filter(Boolean).join(' · ')} · {w.provisions} provisions{w.page_count ? ` · ${w.page_count} pages` : ''}{w.coverage != null ? ` · ${(w.coverage * 100).toFixed(1)}% of the text accounted for` : ''}{w.ocrCorrections ? ` · ${w.ocrCorrections} OCR correction${w.ocrCorrections === 1 ? '' : 's'} checked against the page image` : ''}</span>
            {w.note && <span className="dl-where">Version: {w.note}</span>}
            {ready(w) && <span className="dd-btns"><button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => setConfirm([w])}>Publish</button></span>}
          </li>
        ))}
      </ul>
      {confirm && (
        <Dialog title={confirm.length === 1 ? `Publish ${confirm[0].doc.name} ${confirm[0].version}?` : `Publish ${confirm.length} versions?`} onClose={() => setConfirm(null)} busy={busy}>
          <div className="dd-form">
            <p>Published text becomes the version in force for everyone and is never edited again: corrections keep the old words, a new official file becomes a new version.</p>
            {confirm.length > 1 && <ul className="src" style={{ maxHeight: 220, overflow: 'auto', margin: 0 }}>{confirm.map(w => <li key={w.id}>{w.doc.name} {w.version}</li>)}</ul>}
            <div className="dd-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void publish(confirm)}>{busy ? 'Publishing…' : 'Yes, publish'}</button>
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
