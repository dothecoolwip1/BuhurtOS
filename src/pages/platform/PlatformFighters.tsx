import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Dialog } from '../../components/Dialog';
import { Chip, PageHead } from '../../components/ui';
import { adminListFighters, adminListTeams, adminMergeFighters, adminSetFighterTeam, adminUpdateFighter, validateFighterAdminPatch, type AdminFighterRow } from '../../data/admin';
import { adminRemovePhoto, fetchFighterPhotos, photoUrl, type FighterPhoto } from '../../data/account';
import {
  fetchFighterProfile, GENDERS, HANDEDNESS, profileToForm, SOCIAL_NETWORKS, sportsToForm, validateProfile, validateSports, type FighterProfile
} from '../../data/fighters';
import { fetchAllAdminFighters } from '../../data/platformAdmin';
import { friendlyError } from '../../lib/friendlyError';
import {
  countText, fighterBadges, fighterEditDiff, filterFighters, FIGHTER_TEAM_NOTE, MEDICAL_NOTICE, MERGE_FIGHTERS_NOTICE, PAGE_SIZE, parseList, placeText, visibleCount, type FighterEditForm
} from '../../lib/platformAdmin';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PlatformGate } from './PlatformPages';
import { AuditList, CheckField, Notice, Picker, PlatformNav, Section, SelectField, TextField, useWide } from './parts';

export function PlatformFightersPage() {
  useDocumentTitle('Fighters · Platform');
  return <PlatformGate><FightersAdmin /></PlatformGate>;
}

const searchTeams = async (q: string) => (await adminListTeams(q, 8, 0)).rows.map(t => ({ id: t.teamId, label: t.name, sub: t.slug }));
const searchFighters = async (q: string) => (await adminListFighters(q, null, 8, 0)).rows.map(f => ({ id: f.fighterId, label: f.displayName, sub: f.teamName ?? 'no team' }));

function Badges({ row }: { row: AdminFighterRow }) {
  return <span className="plat-badges">{fighterBadges(row).map(b => <Chip key={b.label} tone={b.tone}>{b.label}</Chip>)}</span>;
}

function FightersAdmin() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [team, setTeam] = useState<{ id: string; label: string } | null>(null);
  const [unclaimed, setUnclaimed] = useState(params.get('unclaimed') === '1');
  const [pages, setPages] = useState(1);
  const [data, setData] = useState<{ rows: AdminFighterRow[]; total: number; capped: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(() => { const o = params.get('open'); return o ? { id: o, name: 'Fighter' } : null; });
  const wide = useWide();

  useEffect(() => { const t = setTimeout(() => setApplied(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  const reload = useCallback(async () => {
    try { setData(await fetchAllAdminFighters(applied === '' ? null : applied, team?.id ?? null)); setError(null); }
    catch (e) { setError(friendlyError(e)); }
  }, [applied, team]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setPages(1); }, [applied, team, unclaimed]);

  const filtered = data ? filterFighters(data.rows, { unclaimedOnly: unclaimed }) : [];
  const shown = filtered.slice(0, visibleCount(pages));
  const closeEditor = () => { setEditing(null); if (params.get('open')) { const p = new URLSearchParams(params); p.delete('open'); setParams(p, { replace: true }); } };

  return (
    <section className="plat" style={{ display: 'grid', gap: 16 }}>
      <PageHead eyebrow="Platform" title="Fighters" lede="Every fighter record, including people who have not claimed theirs." />
      <PlatformNav />
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>{MEDICAL_NOTICE}</p>
      <div className="plat-filters">
        <div className="field-in"><label htmlFor="pf-q">Search by name</label><input id="pf-q" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Fighter name" /></div>
        <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
          {team
            ? <div className="field-in"><span>Team</span><div><Chip tone="steel">{team.label}</Chip> <button type="button" className="linklike" onClick={() => setTeam(null)}>Clear</button></div></div>
            : <Picker label="Team" search={searchTeams} onPick={setTeam} placeholder="Filter by team" />}
        </div>
        <CheckField label="Unclaimed only" checked={unclaimed} onChange={v => { setUnclaimed(v); setParams(v ? { unclaimed: '1' } : {}, { replace: true }); }} hint="No account controls the record" />
      </div>
      {error && <p role="alert" className="plat-err">{error} <button type="button" className="linklike" onClick={() => void reload()}>Try again</button></p>}
      {!data && !error && <p className="muted">Loading fighters…</p>}
      {data && (
        <p className="muted" role="status" style={{ fontSize: 14 }}>
          {countText(filtered.length, 'fighter')} shown{filtered.length !== data.total ? ` of ${data.total}` : ''}.{data.capped ? ` Only the first ${data.rows.length} were loaded; search to narrow the list.` : ''}
        </p>
      )}
      {data && filtered.length === 0 && <p className="muted">No fighters match.</p>}
      {shown.length > 0 && (wide
        ? (
          <div className="table-scroll panel">
            <table className="plat-table">
              <thead><tr><th scope="col">Fighter</th><th scope="col">Team</th><th scope="col">Place</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
              <tbody>{shown.map(r => (
                <tr key={r.fighterId}>
                  <th scope="row">{r.displayName}</th><td>{r.teamName ?? 'No team'}</td><td>{placeText(r) || '–'}</td><td><Badges row={r} /></td>
                  <td><button type="button" className="btn btn-line" onClick={() => setEditing({ id: r.fighterId, name: r.displayName })} aria-label={`Edit ${r.displayName}`}>Edit</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>)
        : (
          <ul className="plain" aria-label="Fighters">{shown.map(r => (
            <li key={r.fighterId} className="panel orgcard">
              <div className="orgcard-top"><b className="org-name">{r.displayName}</b><Badges row={r} /></div>
              <p className="muted" style={{ fontSize: 14, margin: 0 }}>{[r.teamName ?? 'No team', placeText(r)].filter(Boolean).join(' · ')}</p>
              <button type="button" className="btn btn-line" onClick={() => setEditing({ id: r.fighterId, name: r.displayName })} aria-label={`Edit ${r.displayName}`}>Edit fighter</button>
            </li>
          ))}</ul>
        ))}
      {filtered.length > shown.length && <button type="button" className="btn btn-line" onClick={() => setPages(p => p + 1)}>Show {Math.min(PAGE_SIZE, filtered.length - shown.length)} more</button>}
      {editing && <FighterEditor fighterId={editing.id} name={editing.name} onClose={closeEditor} onChanged={reload} />}
    </section>
  );
}

const toForm = (p: FighterProfile): FighterEditForm => ({ displayName: p.displayName, profile: profileToForm(p), sports: sportsToForm(p) });

function FighterEditor({ fighterId, name, onClose, onChanged }: { fighterId: string; name: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [profile, setProfile] = useState<FighterProfile | null>(null);
  const [saved, setSaved] = useState<FighterEditForm | null>(null);
  const [form, setForm] = useState<FighterEditForm | null>(null);
  const [disciplines, setDisciplines] = useState('');
  const [photos, setPhotos] = useState<FighterPhoto[]>([]);
  const [confirmPhoto, setConfirmPhoto] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'edit' | 'merge'>('edit');
  const [newTeam, setNewTeam] = useState<{ id: string; label: string } | null>(null);
  const [target, setTarget] = useState<{ id: string; label: string } | null>(null);
  const [auditTick, setAuditTick] = useState(0);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await fetchFighterProfile(fighterId);
      if (!p) { setMissing(true); return; }
      const f = toForm(p);
      setProfile(p); setSaved(f); setForm(f); setDisciplines(f.profile.disciplines.join(', '));
      setPhotos(await fetchFighterPhotos(fighterId).catch(() => []));
      setAuditTick(t => t + 1);
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); }
  }, [fighterId]);
  useEffect(() => { void load(); }, [load]);

  const setP = <K extends keyof FighterEditForm['profile']>(k: K, v: FighterEditForm['profile'][K]) => setForm(f => (f ? { ...f, profile: { ...f.profile, [k]: v } } : f));
  const setS = <K extends keyof FighterEditForm['sports']>(k: K, v: FighterEditForm['sports'][K]) => setForm(f => (f ? { ...f, sports: { ...f.sports, [k]: v } } : f));
  const run = async (what: () => Promise<void>, done: string) => {
    setBusy(true); setMsg(null);
    try { await what(); await load(); await onChanged(); setMsg({ ok: true, text: done }); }
    catch (e) { setMsg({ ok: false, text: friendlyError(e) }); }
    finally { setBusy(false); }
  };

  const save = () => {
    if (!form || !saved) return;
    const next: FighterEditForm = { ...form, profile: { ...form.profile, disciplines: parseList(disciplines) } };
    const diff = fighterEditDiff(saved, next);
    const errs = { ...validateProfile(next.profile), ...validateSports(next.sports), ...validateFighterAdminPatch(diff) };
    setErrors(errs);
    if (Object.keys(errs).length) { setMsg({ ok: false, text: 'Fix the highlighted fields first.' }); return; }
    if (Object.keys(diff).length === 0) { setMsg({ ok: true, text: 'Nothing has changed.' }); return; }
    void run(() => adminUpdateFighter(fighterId, diff), 'Saved.');
  };
  const doMerge = async () => {
    if (!target) return;
    setBusy(true); setMsg(null);
    try { await adminMergeFighters(target.id, fighterId); await onChanged(); onClose(); }
    catch (e) { setMsg({ ok: false, text: friendlyError(e) }); setBusy(false); }
  };

  const title = profile?.displayName ?? name;
  if (mode === 'merge') {
    return (
      <Dialog title={`Merge duplicate: ${title}`} variant="drawer" onClose={onClose} busy={busy}>
        <Notice lines={MERGE_FIGHTERS_NOTICE} />
        {target
          ? <p>Keep <b>{target.label}</b> and remove the duplicate <b>{title}</b>. <button type="button" className="linklike" onClick={() => setTarget(null)}>Choose a different fighter</button></p>
          : <Picker label="Fighter to keep" exclude={fighterId} search={searchFighters} onPick={setTarget} />}
        {msg && <p role="alert" className="plat-err">{msg.text}</p>}
        <div className="dlg-actions">
          <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setMode('edit'); setMsg(null); }}>Back</button>
          <button type="button" className="btn btn-danger" disabled={busy || !target} onClick={() => void doMerge()}>{busy ? 'Merging…' : target ? `Merge into ${target.label}` : 'Merge'}</button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={title} variant="drawer" onClose={onClose} busy={busy}>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>{MEDICAL_NOTICE}</p>
      {missing && <p className="plat-err" role="alert">This fighter no longer exists. Close this and refresh the list.</p>}
      {!form && !missing && !msg && <p className="muted">Loading…</p>}
      {profile && <p style={{ margin: 0 }}><Link className="more" to={`/fighters/${fighterId}`}>View public page</Link></p>}
      {form && (
        <form onSubmit={e => { e.preventDefault(); save(); }} style={{ display: 'grid', gap: 14 }} noValidate>
          <Section title="Name">
            <TextField label="Display name" value={form.displayName} onChange={v => setForm({ ...form, displayName: v })} error={errors.display_name} />
          </Section>
          <Section title="Profile">
            <TextField label="Nickname" value={form.sports.nickname} onChange={v => setS('nickname', v)} error={errors.nickname} />
            <TextField label="Pronouns" value={form.sports.pronouns} onChange={v => setS('pronouns', v)} error={errors.pronouns} />
            <SelectField label="Gender" value={form.profile.gender} onChange={v => setP('gender', v)} error={errors.gender} options={[['', 'Not set'], ...GENDERS.map(g => [g, g] as const)]} />
            <TextField label="Birth year" value={form.profile.birthYear} onChange={v => setP('birthYear', v)} error={errors.birthYear} inputMode="numeric" maxLength={4} />
            <TextField label="City" value={form.profile.city} onChange={v => setP('city', v)} error={errors.city} />
            <TextField label="Region" value={form.profile.region} onChange={v => setP('region', v)} error={errors.region} />
            <TextField label="Country" value={form.profile.country} onChange={v => setP('country', v)} error={errors.country} />
            <TextField label="Joined year" value={form.profile.joinedYear} onChange={v => setP('joinedYear', v)} error={errors.joinedYear} inputMode="numeric" maxLength={4} />
            <TextField label="Disciplines (comma separated codes)" value={disciplines} onChange={setDisciplines} error={errors.disciplines} />
            <TextField label="Fighting style" value={form.profile.fightingStyle} onChange={v => setP('fightingStyle', v)} error={errors.fightingStyle} />
            <TextField label="Bio" value={form.profile.bio} onChange={v => setP('bio', v)} error={errors.bio} multiline maxLength={1500} />
            <TextField label="Highlights (one per line)" value={form.profile.highlights.join('\n')} onChange={v => setP('highlights', v.split('\n'))} error={errors.highlights} multiline />
          </Section>
          <Section title="Sports card">
            <SelectField label="Handedness" value={form.sports.handedness} onChange={v => setS('handedness', v)} error={errors.handedness} options={[['', 'Not set'], ...HANDEDNESS.map(h => [h, h] as const)]} />
            <TextField label="Jersey number" value={form.sports.jerseyNumber} onChange={v => setS('jerseyNumber', v)} error={errors.jerseyNumber} inputMode="numeric" maxLength={3} />
            <TextField label="Height (cm)" value={form.sports.heightCm} onChange={v => setS('heightCm', v)} error={errors.heightCm} inputMode="numeric" maxLength={3} />
            <TextField label="Weight (kg)" value={form.sports.weightKg} onChange={v => setS('weightKg', v)} error={errors.weightKg} inputMode="decimal" maxLength={5} />
            {SOCIAL_NETWORKS.map(n => <TextField key={n} label={`${n} link`} value={form.sports.socialLinks[n] ?? ''} inputMode="url" onChange={v => setS('socialLinks', { ...form.sports.socialLinks, [n]: v })} />)}
            {errors.socialLinks && <span className="plat-err" style={{ fontSize: 13 }}>{errors.socialLinks}</span>}
          </Section>
          <Section title="Visibility">
            <CheckField label="Public profile" checked={form.sports.profilePublic} onChange={v => setS('profilePublic', v)} hint="Off shows only the name and team to the public" />
            <CheckField label="Show age" checked={form.sports.showAge} onChange={v => setS('showAge', v)} />
            <CheckField label="Show height and weight" checked={form.sports.showPhysical} onChange={v => setS('showPhysical', v)} />
          </Section>
          <div className="dlg-actions"><button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Working…' : 'Save changes'}</button></div>
        </form>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'muted' : 'plat-err'}>{msg.text}</p>}
      {profile && (
        <>
          <Section title="Team">
            <p style={{ margin: 0 }}>{profile.team ? <>On <Link className="more" to={`/teams/${profile.team.slug}`}>{profile.team.name}</Link></> : 'Not on a team.'}</p>
            {newTeam
              ? <p style={{ margin: 0 }}>Move to <b>{newTeam.label}</b>? <button type="button" className="linklike" onClick={() => setNewTeam(null)}>Cancel</button></p>
              : <Picker label="Move to team" search={searchTeams} onPick={setNewTeam} />}
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{FIGHTER_TEAM_NOTE}</p>
            <div className="dlg-actions" style={{ justifyContent: 'flex-start' }}>
              {newTeam && <button type="button" className="btn btn-ink" disabled={busy} onClick={() => { const t = newTeam; setNewTeam(null); void run(() => adminSetFighterTeam(fighterId, t.id), `Moved to ${t.label}.`); }}>Move to {newTeam.label}</button>}
              {profile.team && !newTeam && <button type="button" className="btn btn-line" disabled={busy} onClick={() => void run(() => adminSetFighterTeam(fighterId, null), 'Removed from the team.')}>Remove from team</button>}
            </div>
          </Section>
          <Section title={`Photos (${photos.length})`}>
            {photos.length === 0 && <p className="muted">No photos{profile.profilePublic ? '' : ' are visible while the profile is private'}.</p>}
            <ul className="plain plat-photos">{photos.map(p => (
              <li key={p.id}>
                <img src={photoUrl(p.path) ?? ''} alt={p.caption ?? 'Fighter photo'} width={96} height={96} loading="lazy" />
                {p.isPrimary && <Chip tone="win">Main photo</Chip>}
                <div className="plat-photo-act">
                  {!p.isPrimary && <button type="button" className="btn btn-line" disabled={busy} onClick={() => void run(() => adminUpdateFighter(fighterId, { photo_path: p.path }), 'Main photo changed.')}>Make main</button>}
                  {confirmPhoto === p.id
                    ? <button type="button" className="btn btn-danger" disabled={busy} onClick={() => { setConfirmPhoto(null); void run(() => adminRemovePhoto(p.id), 'Photo removed.'); }}>Remove for good</button>
                    : <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirmPhoto(p.id)}>Remove</button>}
                </div>
              </li>
            ))}</ul>
          </Section>
          <Section title="Recent changes"><AuditList subject={fighterId} refresh={auditTick} /></Section>
          <Section title="Merge">
            <p className="muted" style={{ margin: 0 }}>Is this record a duplicate of another fighter?</p>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setMode('merge'); setMsg(null); }}>Merge duplicate fighter…</button>
          </Section>
        </>
      )}
    </Dialog>
  );
}
