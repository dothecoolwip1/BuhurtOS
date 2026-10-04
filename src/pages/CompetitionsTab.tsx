import { useMemo, useState } from 'react';
import { Chip } from '../components/ui';
import type { LiveEvent } from '../data/api';
import {
  DIVISIONS, LEAGUE_LABEL, STRUCTURES, createCompetition, deleteCompetition, fetchRefCategories, fetchSetupCompetitions, suggestName, updateCompetition, validateCompetition,
  type CompetitionInput, type Division, type RefCategory, type SetupCompetition, type Structure
} from '../data/competitions';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

const bad: React.CSSProperties = { color: 'var(--live)' };
const blank = (): CompetitionInput => ({ name: '', category: '', gender: 'open', ruleset: '', structure: 'round_robin', roundsToWin: null });
const toInput = (k: SetupCompetition): CompetitionInput => ({ name: k.name, category: k.category, gender: k.gender, ruleset: k.ruleset ?? '', structure: k.structure, roundsToWin: k.roundsToWin });

/**
 * The organizer's competition list: add, change and remove the categories an event runs. The database (create/update/delete_competition)
 * decides who may do it and refuses to remove anything that already has registrations, entries or matches.
 */
export function CompetitionsTab({ event, onChanged }: { event: LiveEvent; onChanged: () => void }) {
  const [key, setKey] = useState(0);
  const list = useAsync(() => fetchSetupCompetitions(event.id), [event.id, key]);
  const cats = useAsync(fetchRefCategories, []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = (text?: string) => { setKey(k => k + 1); onChanged(); if (text) setMsg({ ok: true, text }); };
  const comps = list.data ?? [];
  const byLeague = useMemo(() => {
    const groups = new Map<string, SetupCompetition[]>();
    for (const k of comps) groups.set(k.league, [...(groups.get(k.league) ?? []), k]);
    return [...groups.entries()];
  }, [comps]);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="comps-h">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <h3 id="comps-h">Competitions ({comps.length})</h3>
          {!adding && <button type="button" className="btn btn-ink" onClick={() => { setAdding(true); setEditing(null); setMsg(null); }}>+ Add competition</button>}
        </div>
        <p className="src">Each competition is one category people enter and one bracket you run: for example Men 5v5, Women Longsword. Fighters choose from this list when they register.</p>
        {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--win)' : 'var(--live)' }}>{msg.text}</p>}
        {list.loading && !list.data && <p className="muted">Loading…</p>}
        {list.error != null && <p role="alert" style={bad}>{friendlyError(list.error, 'Could not load the competitions.')}</p>}
        {cats.error != null && <p role="alert" style={bad}>{friendlyError(cats.error, 'Could not load the category list.')}</p>}
        {list.data && comps.length === 0 && !adding && (
          <p className="muted">No competitions yet. {event.eventType === 'tournament' ? 'A tournament needs at least one before it can be published.' : 'Add one if people will compete at this event.'}</p>
        )}
        {adding && cats.data && (
          <CompetitionForm title="New competition" categories={cats.data} initial={blank()} locked={false}
            onCancel={() => setAdding(false)}
            onSave={async i => { await createCompetition(event.id, i); setAdding(false); refresh(`Added ${i.name.trim()}.`); }} />
        )}
      </section>

      {byLeague.map(([league, items]) => (
        <section key={league} className="panel info" style={{ display: 'grid', gap: 10 }} aria-label={LEAGUE_LABEL[league as keyof typeof LEAGUE_LABEL] ?? league}>
          <h3>{LEAGUE_LABEL[league as keyof typeof LEAGUE_LABEL] ?? league}</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {items.map(k => (
              <li key={k.id} style={{ display: 'grid', gap: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                {editing === k.id && cats.data ? (
                  <CompetitionForm title={`Change ${k.name}`} categories={cats.data} initial={toInput(k)} locked={k.matches > 0} finished={k.status === 'finished'}
                    onCancel={() => setEditing(null)}
                    onSave={async i => { await updateCompetition(k.id, i); setEditing(null); refresh(`Saved ${i.name.trim()}.`); }} />
                ) : (
                  <CompetitionRow k={k} onEdit={() => { setEditing(k.id); setAdding(false); setMsg(null); }} onRemoved={() => refresh(`Removed ${k.name}.`)} onError={text => setMsg({ ok: false, text })} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CompetitionRow({ k, onEdit, onRemoved, onError }: { k: SetupCompetition; onEdit: () => void; onRemoved: () => void; onError: (text: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const dependents = k.registrations + k.entries + k.matches;
  const structure = STRUCTURES.find(([s]) => s === k.structure)?.[1] ?? k.structure;
  const division = DIVISIONS.find(([d]) => d === k.gender)?.[1] ?? k.gender;
  const remove = async () => {
    setBusy(true);
    try { await deleteCompetition(k.id); onRemoved(); } catch (e) { onError(friendlyError(e, 'Could not remove the competition.')); setConfirming(false); } finally { setBusy(false); }
  };
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ overflowWrap: 'anywhere' }}>{k.name}</b>
        <Chip>{division}</Chip>
        {k.status === 'finished' && <Chip tone="win">Finished</Chip>}
        {k.matches > 0 && k.status !== 'finished' && <Chip tone="brass">Draw made</Chip>}
      </div>
      <p className="src" style={{ margin: 0 }}>
        {structure}{k.roundsToWin ? ` · first to ${k.roundsToWin} ${k.roundsToWin === 1 ? 'round' : 'rounds'}` : ''} · {k.ruleset ?? 'Ruleset not set'}
        {dependents > 0 && <> · {[k.registrations ? `${k.registrations} registered` : '', k.entries ? `${k.entries} ${k.entries === 1 ? 'entry' : 'entries'}` : '', k.matches ? `${k.matches} ${k.matches === 1 ? 'match' : 'matches'}` : ''].filter(Boolean).join(', ')}</>}
      </p>
      {!confirming && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {k.status !== 'finished' && <button type="button" className="btn btn-line btn-sm" onClick={onEdit}>Change</button>}
          {dependents === 0 && <button type="button" className="btn btn-line btn-sm" onClick={() => setConfirming(true)}>Remove</button>}
          {dependents > 0 && k.status !== 'finished' && <span className="src">Cannot be removed: people have registered or entered, or matches exist.</span>}
        </div>
      )}
      {confirming && (
        <div className="panel info" role="alertdialog" aria-label={`Remove ${k.name}`} style={{ display: 'grid', gap: 8 }}>
          <p><b>Remove {k.name}?</b> Nobody has registered or been entered for it, so nothing else changes.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Yes, remove it'}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        </div>
      )}
    </>
  );
}

function CompetitionForm({ title, categories, initial, locked, finished = false, onCancel, onSave }: {
  title: string; categories: RefCategory[]; initial: CompetitionInput; locked: boolean; finished?: boolean; onCancel: () => void; onSave: (i: CompetitionInput) => Promise<void>;
}) {
  const [f, setF] = useState<CompetitionInput>(initial);
  const [touchedName, setTouchedName] = useState(Boolean(initial.name));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const errors = validateCompetition(f);
  const err = (k: string) => (show && errors[k] ? <span role="alert" style={bad}>{errors[k]}</span> : null);
  const cat = categories.find(c => c.code === f.category);
  const set = <K extends keyof CompetitionInput>(k: K, v: CompetitionInput[K]) => setF(p => ({ ...p, [k]: v }));
  const pick = (next: Partial<Pick<CompetitionInput, 'category' | 'gender'>>) => {
    setF(p => {
      const merged = { ...p, ...next };
      return touchedName ? merged : { ...merged, name: suggestName(categories.find(c => c.code === merged.category), merged.gender) };
    });
  };
  const leagues = [...new Set(categories.map(c => c.league))];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try { await onSave(f); } catch (x) { setProblem(friendlyError(x, 'Could not save the competition.')); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={e => void submit(e)} noValidate className="panel info" style={{ display: 'grid', gap: 12 }} aria-label={title}>
      <h4>{title}</h4>
      {finished && <p role="status" className="src">This competition is finished: its setup is part of the record and cannot change.</p>}
      {locked && !finished && <p role="status" className="src">The draw is made, so the category and division are fixed; the structure now follows the draw. You can still change the name, ruleset and rounds to win.</p>}
      <label className="field-in">Category
        <select value={f.category} disabled={locked || finished} onChange={e => pick({ category: e.target.value })} aria-invalid={Boolean(show && errors.category)}>
          <option value="">Choose…</option>
          {leagues.map(l => (
            <optgroup key={l} label={LEAGUE_LABEL[l] ?? l}>{categories.filter(c => c.league === l).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</optgroup>
          ))}
        </select>{err('category')}
      </label>
      <div className="field-in"><span>Division</span>
        <div className="seg" role="group" aria-label="Division">
          {DIVISIONS.map(([d, label]) => <button key={d} type="button" disabled={locked || finished} aria-pressed={f.gender === d} onClick={() => pick({ gender: d as Division })}>{label}</button>)}
        </div>
      </div>
      <label className="field-in">Name (what fighters and spectators see)
        <input value={f.name} maxLength={80} disabled={finished} onChange={e => { setTouchedName(true); set('name', e.target.value); }} aria-invalid={Boolean(show && errors.name)} />{err('name')}
      </label>
      <label className="field-in">Ruleset (optional, as you announce it)
        <input value={f.ruleset} maxLength={120} disabled={finished} placeholder={cat?.league === 'buhurt' ? 'For example Buhurt Rules V.26.4.1' : cat?.league === 'duels' ? 'For example Duels V.26.4' : 'For example the document and version'} onChange={e => set('ruleset', e.target.value)} />{err('ruleset')}
      </label>
      <label className="field-in">Structure
        <select value={f.structure} disabled={locked || finished} onChange={e => set('structure', e.target.value as Structure)}>
          {STRUCTURES.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
        </select>
        <span>{STRUCTURES.find(([s]) => s === f.structure)?.[2]} You can still choose a different draw when you build it.</span>
      </label>
      <label className="field-in">Rounds to win (optional; for group fights, for example 2 for best of three)
        <input type="number" inputMode="numeric" min={1} max={5} disabled={finished} value={f.roundsToWin ?? ''} onChange={e => set('roundsToWin', e.target.value === '' ? null : Number(e.target.value))} aria-invalid={Boolean(show && errors.roundsToWin)} />{err('roundsToWin')}
      </label>
      {problem && <p role="alert" style={bad}>{problem}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-ink" disabled={busy || finished}>{busy ? 'Saving…' : 'Save competition'}</button>
        <button type="button" className="btn btn-line" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
