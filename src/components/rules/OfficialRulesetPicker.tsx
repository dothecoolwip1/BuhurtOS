import { useState } from 'react';
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
  if (!index) return null;
  const linked = current ? index.versionById.get(current) ?? null : null;
  const linkedDoc = linked ? index.docById.get(linked.ruleset_id) ?? null : null;
  const options = index.data.versions
    .filter(v => v.status === 'published' || v.id === current)
    .map(v => ({ v, d: index.docById.get(v.ruleset_id)! }))
    .filter(x => x.d && (sample || !x.d.synthetic || x.v.id === current) && (x.d.applies_to.length === 0 || x.d.applies_to.includes(league)) && (x.d.kind === 'rules' || x.d.kind === 'regulations' || x.v.id === current))
    .sort((a, b) => a.d.name.localeCompare(b.d.name));
  if (!options.length && !current) return null;
  const label = linked && linkedDoc ? `${linkedDoc.name} ${linked.version}` : null;
  if (finished) return label ? <p className="src" style={{ margin: 0 }}>Fought under <Link className="lnk" to={`/rules/doc/${linkedDoc!.slug}?v=${linked!.id}`}>{label}</Link></p> : null;
  const save = async (next: string | null) => {
    setBusy(true); setMsg(null);
    try { await setCompetitionRulesetVersion(competitionId, next); setCurrent(next); setMsg('Saved.'); }
    catch (e) { setMsg(friendlyError(e, 'Could not link the ruleset.')); } finally { setBusy(false); }
  };
  return (
    <label className="field-in" style={{ margin: 0 }}>Official ruleset in BuhurtOS (optional)
      <select value={current ?? ''} disabled={busy} onChange={e => void save(e.target.value || null)} aria-describedby={`rv-${competitionId}`}>
        <option value="">Not linked</option>
        {options.map(({ v, d }) => <option key={v.id} value={v.id}>{d.name} · {v.version}{v.status !== 'published' ? ` (${v.status})` : ''}{d.synthetic ? ' · test' : ''}</option>)}
      </select>
      <span id={`rv-${competitionId}`} className="src">{msg ?? (label ? <>Officials can open <Link className="lnk" to={`/rules/doc/${linkedDoc!.slug}?v=${linked!.id}`}>{label}</Link> from the rules. It is fixed once the competition is finished.</> : 'Links the competition to the exact rules text it is fought under.')}</span>
    </label>
  );
}
