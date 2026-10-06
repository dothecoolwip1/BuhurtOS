import { useEffect, useState } from 'react';
import { applyCurrentDocuments, fetchCompetitionRulesets } from '../../data/discipline';
import { Link } from 'react-router-dom';
import { setCompetitionRulesetVersion } from '../../data/rules';
import { friendlyError } from '../../lib/friendlyError';
import { useRules } from '../../lib/rules/useRules';
import { useSampleMode } from '../../data/mode';

/**
 * Pack 22: link a competition to the official ruleset version it is fought under (rules library), so its results keep pointing at the wording in
 * force at the time. Optional and separate from the free-text ruleset label. Shown only when the library has a published version for this format.
 * The database decides who may change it and freezes it once the competition is finished.
 */
export function OfficialRulesetPicker({ competitionId, league, value, finished }: { competitionId: string; league: string; value: string | null; finished: boolean }) {
  const { index } = useRules();
  const sample = useSampleMode();
  const [current, setCurrent] = useState<string | null>(value);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Pack 22: every official document the competition is fought under (any governing body), not only its primary rulebook.
  const [docs, setDocs] = useState<string[] | null>(null);
  useEffect(() => { let live = true; fetchCompetitionRulesets(competitionId).then(d => { if (live) setDocs(d); }).catch(() => { if (live) setDocs([]); }); return () => { live = false; }; }, [competitionId]);
  if (!index) return null;
  const bodies = [...new Set(index.data.versions.filter(v => v.status === 'published').map(v => index.docById.get(v.ruleset_id)).filter(d => d && !d.synthetic && d.governing_body && (d.applies_to.length === 0 || d.applies_to.includes(league))).map(d => d!.governing_body!))];
  const docNames = (docs ?? []).map(id => { const v = index.versionById.get(id); const d = v ? index.docById.get(v.ruleset_id) : null; return d && v ? { id, slug: d.slug, label: `${d.name} ${v.version}` } : null; }).filter(Boolean) as { id: string; slug: string; label: string }[];
  const applyBody = async (body: string) => {
    setBusy(true); setMsg(null);
    try { const r = await applyCurrentDocuments(competitionId, body); setDocs(await fetchCompetitionRulesets(competitionId)); if (r.primary) setCurrent(r.primary); setMsg(r.status === 'unchanged' ? 'Already using them.' : `Using ${r.count} ${body} documents.`); }
    catch (e) { setMsg(friendlyError(e, 'Could not apply the documents.')); } finally { setBusy(false); }
  };
  const docList = docNames.length > 0 && (
    <details className="desk-more"><summary>Fought under {docNames.length} official document{docNames.length === 1 ? '' : 's'}</summary>
      <ul className="src" style={{ margin: 0, paddingLeft: 18 }}>{docNames.map(d => <li key={d.id}><Link className="lnk" to={`/rules/doc/${d.slug}?v=${d.id}`}>{d.label}</Link></li>)}</ul>
    </details>
  );
  const linked = current ? index.versionById.get(current) ?? null : null;
  const linkedDoc = linked ? index.docById.get(linked.ruleset_id) ?? null : null;
  const options = index.data.versions
    .filter(v => v.status === 'published' || v.id === current)
    .map(v => ({ v, d: index.docById.get(v.ruleset_id)! }))
    .filter(x => x.d && (sample || !x.d.synthetic || x.v.id === current) && (x.d.applies_to.length === 0 || x.d.applies_to.includes(league)) && (x.d.kind === 'rules' || x.d.kind === 'regulations' || x.v.id === current))
    .sort((a, b) => a.d.name.localeCompare(b.d.name));
  if (!options.length && !current) return null;
  const label = linked && linkedDoc ? `${linkedDoc.name} ${linked.version}${linked.historical ? ' (earlier edition, not in force)' : ''}` : null;
  if (finished) return label || docList ? <>{label && <p className="src" style={{ margin: 0 }}>Fought under <Link className="lnk" to={`/rules/doc/${linkedDoc!.slug}?v=${linked!.id}`}>{label}</Link></p>}{docList}</> : null;
  const save = async (next: string | null) => {
    setBusy(true); setMsg(null);
    try { await setCompetitionRulesetVersion(competitionId, next); setCurrent(next); setMsg('Saved.'); }
    catch (e) { setMsg(friendlyError(e, 'Could not link the ruleset.')); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
    <label className="field-in" style={{ margin: 0 }}>Official ruleset in BuhurtOS (optional)
      <select value={current ?? ''} disabled={busy} onChange={e => void save(e.target.value || null)} aria-describedby={`rv-${competitionId}`}>
        <option value="">Not linked</option>
        {options.map(({ v, d }) => <option key={v.id} value={v.id}>{d.name} · {v.version}{v.historical ? ' (earlier edition)' : v.status !== 'published' ? ` (${v.status})` : ''}{d.synthetic ? ' · test' : ''}</option>)}
      </select>
      <span id={`rv-${competitionId}`} className="src">{msg ?? (label ? <>Officials can open <Link className="lnk" to={`/rules/doc/${linkedDoc!.slug}?v=${linked!.id}`}>{label}</Link> from the rules. It is fixed once the competition is finished.</> : 'Links the competition to the exact rules text it is fought under.')}</span>
    </label>
    {bodies.map(b => <button key={b} type="button" className="btn btn-line btn-sm" style={{ justifySelf: 'start' }} disabled={busy} onClick={() => void applyBody(b)}>Use the current {b} documents for this format</button>)}
    {docList}
    </div>
  );
}
