import { useState } from 'react';
import { Chip } from '../components/ui';
import {
  createCompetition, deleteCompetition, fetchCategoryRefs, fetchEventCompetitions, fetchTierNames, GENDERS, STRUCTURES, suggestCompetitionName, updateCompetition, validateCompetition,
  type CompetitionInput, type EventCompetition
} from '../data/competitions';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

const LEAGUE_WORD: Record<string, string> = { buhurt: 'Group fight', duels: 'Duel', outrance: 'Profight', hacsa: 'HACSA' };
const blank = (sort: number): CompetitionInput => ({ name: '', category: '', gender: 'men', tier: null, ruleset: '', structure: 'round_robin', roundsToWin: null, sort });
const bad: React.CSSProperties = { color: 'var(--live)' };

/**
 * The competitions of an event, inside Setup: the list, "Add competition", edit, and remove (only while nothing hangs off it; the
 * database refuses otherwise). Saving tells the parent so the publish checklist and the Run tab see the change.
 */
export function CompetitionsSection({ eventId, eventType, onChanged, autoOpen = false }: { eventId: string; eventType: string; onChanged: () => void; autoOpen?: boolean }) {
  const [key, setKey] = useState(0);
  const list = useAsync(() => fetchEventCompetitions(eventId), [eventId, key]);
  const cats = useAsync(fetchCategoryRefs, []);
  const tiers = useAsync(fetchTierNames, []);
  const [editing, setEditing] = useState<'new' | string | null>(autoOpen ? 'new' : null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const rows = list.data ?? [];
  const changed = () => { setKey(k => k + 1); onChanged(); };

  const remove = async (c: EventCompetition) => {
    setBusy(c.id); setProblem(null);
    try { await deleteCompetition(c.id); setConfirmRemove(null); changed(); } catch (e) { setProblem(friendlyError(e, 'Could not remove the competition.')); } finally { setBusy(null); }
  };

  return (
    <section className="panel info" aria-labelledby="comps-h" id="competitions" style={{ display: 'grid', gap: 12, scrollMarginTop: 96 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 id="comps-h" style={{ margin: 0 }}>Competitions {list.data && <Chip tone={rows.length ? 'win' : 'brass'}>{rows.length}</Chip>}</h3>
        {editing !== 'new' && <button type="button" className="btn btn-ink" data-testid="add-competition" onClick={() => { setEditing('new'); setProblem(null); }}>+ Add competition</button>}
      </div>
      <p className="src">{eventType === 'tournament' ? 'A tournament needs at least one competition before it can be published. ' : ''}Each competition has its own category, division and bracket; fighters pick them when they register, and the draw is built on the Run tab.</p>
      {list.loading && !list.data && <p className="muted">Loading…</p>}
      {list.error != null && <p role="alert" style={bad}>{friendlyError(list.error, 'Could not load the competitions.')}</p>}
      {list.data && rows.length === 0 && editing !== 'new' && <p className="muted">No competitions yet.</p>}
      {editing === 'new' && (
        <CompetitionForm initial={blank(rows.length ? Math.max(...rows.map(r => r.sort)) + 1 : 1)} categories={cats.data ?? []} tiers={tiers.data ?? []} title="New competition"
          onCancel={() => setEditing(null)} onSave={async c => { await createCompetition(eventId, c); setEditing(null); changed(); }} />
      )}
      <ul className="plain" style={{ display: 'grid', gap: 10, margin: 0 }}>
        {rows.map(c => (
          <li key={c.id} className="panel" style={{ padding: '12px 14px', display: 'grid', gap: 8 }} data-testid="competition-row">
            {editing === c.id ? (
              <CompetitionForm initial={{ name: c.name, category: c.category, gender: c.gender, tier: c.tier, ruleset: c.ruleset ?? '', structure: c.structure, roundsToWin: c.roundsToWin, sort: c.sort }}
                categories={cats.data ?? []} tiers={tiers.data ?? []} title={`Edit ${c.name}`} locked={c.status === 'finished'}
                onCancel={() => setEditing(null)} onSave={async n => { await updateCompetition(c.id, n); setEditing(null); changed(); }} />
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <b style={{ overflowWrap: 'anywhere' }}>{c.name}</b>
                  <Chip>{LEAGUE_WORD[c.league] ?? c.league}</Chip><Chip>{GENDERS.find(([k]) => k === c.gender)?.[1]}</Chip>
                  {c.tier && <Chip tone="steel">{c.tier}</Chip>}
                  {c.entries > 0 && <Chip tone="brass">{c.entries} entrant{c.entries === 1 ? '' : 's'}</Chip>}
                  {c.status !== 'setup' && <Chip tone={c.status === 'finished' ? 'win' : 'live'}>{c.status}</Chip>}
                </div>
                <span className="src">{STRUCTURES.find(([k]) => k === c.structure)?.[1]}{c.ruleset ? ` · ${c.ruleset}` : ' · ruleset not set'}</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-line btn-sm" disabled={busy !== null} onClick={() => { setEditing(c.id); setProblem(null); }}>Edit</button>
                  {c.entries === 0 && c.status === 'setup' && confirmRemove !== c.id && <button type="button" className="btn btn-line btn-sm" disabled={busy !== null} onClick={() => setConfirmRemove(c.id)}>Remove</button>}
                  {confirmRemove === c.id && (
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span>Remove {c.name}?</span>
                      <button type="button" className="btn btn-ink btn-sm" disabled={busy === c.id} onClick={() => void remove(c)}>Yes, remove</button>
                      <button type="button" className="btn btn-line btn-sm" onClick={() => setConfirmRemove(null)}>Keep</button>
                    </span>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {problem && <p role="alert" style={bad}>{problem}</p>}
      {rows.some(c => c.entries > 0) && <p className="src">A competition with entrants, matches or results is part of the event's record and cannot be removed; results are corrected or voided on the Run tab instead.</p>}
    </section>
  );
}

function CompetitionForm({ initial, categories, tiers, title, locked = false, onSave, onCancel }: {
  initial: CompetitionInput; categories: Array<{ code: string; name: string; league: string }>; tiers: string[]; title: string; locked?: boolean;
  onSave: (c: CompetitionInput) => Promise<void>; onCancel: () => void;
}) {
  const [f, setF] = useState<CompetitionInput>(initial);
  const [touchedName, setTouchedName] = useState(Boolean(initial.name));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const errors = validateCompetition(f);
  const set = <K extends keyof CompetitionInput>(k: K, v: CompetitionInput[K]) => setF(p => ({ ...p, [k]: v }));
  const err = (k: string) => (show && errors[k] ? <span role="alert" style={bad}>{errors[k]}</span> : null);
  const league = categories.find(c => c.code === f.category)?.league;
  const pickCategory = (code: string) => {
    const name = categories.find(c => c.code === code)?.name ?? '';
    setF(p => ({ ...p, category: code, name: touchedName ? p.name : suggestCompetitionName(name, p.gender) }));
  };
  const pickGender = (g: CompetitionInput['gender']) => {
    const name = categories.find(c => c.code === f.category)?.name ?? '';
    setF(p => ({ ...p, gender: g, name: touchedName ? p.name : suggestCompetitionName(name, g) }));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try { await onSave({ ...f, name: f.name.trim(), ruleset: f.ruleset?.trim() || null }); } catch (x) { setProblem(friendlyError(x, 'Could not save the competition.')); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={e => void submit(e)} noValidate className="panel" style={{ padding: 14, display: 'grid', gap: 12 }} aria-label={title}>
      <h4 style={{ margin: 0 }}>{title}</h4>
      {locked && <p className="src">This competition is finished. Its name and ruleset can still be corrected; its category and bracket cannot.</p>}
      <div className="form">
        <label className="field-in">Category
          <select value={f.category} disabled={locked} onChange={e => pickCategory(e.target.value)} aria-invalid={Boolean(show && errors.category)}>
            <option value="">Choose…</option>
            {categories.map(c => <option key={c.code} value={c.code}>{c.name} ({LEAGUE_WORD[c.league] ?? c.league})</option>)}
          </select>{err('category')}
        </label>
        <label className="field-in">Division
          <select value={f.gender} disabled={locked} onChange={e => pickGender(e.target.value as CompetitionInput['gender'])}>{GENDERS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
      </div>
      <label className="field-in">Name (as fighters will see it)
        <input value={f.name} maxLength={80} onChange={e => { setTouchedName(true); set('name', e.target.value); }} aria-invalid={Boolean(show && errors.name)} />{err('name')}
      </label>
      <div className="form">
        <label className="field-in">Format
          <select value={f.structure} disabled={locked} onChange={e => set('structure', e.target.value as CompetitionInput['structure'])}>{STRUCTURES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
        <label className="field-in">Tier (league points)
          <select value={f.tier ?? ''} disabled={locked} onChange={e => set('tier', e.target.value || null)}>
            <option value="">No tier (no league points)</option>
            {tiers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label className="field-in">Ruleset (as announced, for example "Buhurt Rules V.26.4.1")
        <input value={f.ruleset ?? ''} maxLength={120} onChange={e => set('ruleset', e.target.value)} />{err('ruleset')}
      </label>
      {league === 'buhurt' && (
        <label className="field-in">Rounds to win (group fights, optional)
          <input inputMode="numeric" value={f.roundsToWin ?? ''} disabled={locked} onChange={e => set('roundsToWin', e.target.value.trim() === '' ? null : Number(e.target.value))} aria-invalid={Boolean(show && errors.roundsToWin)} />{err('roundsToWin')}
        </label>
      )}
      <label className="field-in" style={{ maxWidth: 200 }}>Order on the page
        <input inputMode="numeric" value={f.sort} onChange={e => set('sort', Number(e.target.value) || 0)} />
      </label>
      {problem && <p role="alert" style={bad}>{problem}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-ink" disabled={busy} data-testid="save-competition">{busy ? 'Saving…' : 'Save competition'}</button>
        <button type="button" className="btn btn-line" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
