import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Dialog } from '../../components/Dialog';
import { Chip, PageHead } from '../../components/ui';
import {
  adminListTeams, adminUpdateTeam, CREST_DIVISIONS, fetchTeamEditForm, slugify, teamEditDiff, validateTeamEdit, type AdminTeamRow, type TeamEditForm
} from '../../data/admin';
import { clearTeamImage, photoUrl, uploadTeamImage, validatePhotoFile } from '../../data/account';
import { SOCIAL_NETWORKS } from '../../data/fighters';
import { fetchAllAdminTeams, fetchTeamLogoPath } from '../../data/platformAdmin';
import { fetchTeamRoster, type RosterMember } from '../../data/teamManager';
import { mergeTeams } from '../../data/teams';
import { friendlyError } from '../../lib/friendlyError';
import {
  countText, filterTeams, MERGE_TEAMS_NOTICE, ORG_ALL, ORG_NONE, orgOptions, PAGE_SIZE, placeText, STATUS_OPTIONS, teamBadges, visibleCount, type TeamStatusFilter
} from '../../lib/platformAdmin';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PlatformGate } from './PlatformPages';
import { AuditList, Notice, Picker, PlatformNav, Section, SelectField, TextField, useWide } from './parts';

export function PlatformTeamsPage() {
  useDocumentTitle('Teams · Platform');
  return <PlatformGate><TeamsAdmin /></PlatformGate>;
}

function Badges({ row }: { row: AdminTeamRow }) {
  return <span className="plat-badges">{teamBadges(row).map(b => <Chip key={b.label} tone={b.tone}>{b.label}</Chip>)}</span>;
}

function TeamsAdmin() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState<TeamStatusFilter>((['pending', 'approved'] as string[]).includes(params.get('status') ?? '') ? (params.get('status') as TeamStatusFilter) : 'all');
  const [org, setOrg] = useState(ORG_ALL);
  const [pages, setPages] = useState(1);
  const [data, setData] = useState<{ rows: AdminTeamRow[]; total: number; capped: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminTeamRow | null>(null);
  const wide = useWide();

  useEffect(() => { const t = setTimeout(() => setApplied(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  // Always the server's answer. A failed re-fetch keeps the last list and says so.
  const reload = useCallback(async () => {
    try { setData(await fetchAllAdminTeams(applied === '' ? null : applied)); setError(null); }
    catch (e) { setError(friendlyError(e)); }
  }, [applied]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setPages(1); }, [applied, status, org]);

  const changeStatus = (s: TeamStatusFilter) => { setStatus(s); setParams(s === 'all' ? {} : { status: s }, { replace: true }); };
  const filtered = data ? filterTeams(data.rows, { status, org }) : [];
  const shown = filtered.slice(0, visibleCount(pages));
  const orgs = data ? orgOptions(data.rows) : [];

  return (
    <section className="plat" style={{ display: 'grid', gap: 16 }}>
      <PageHead eyebrow="Platform" title="Teams" lede="Every team, including teams waiting for approval and teams of switched-off organizations." />
      <PlatformNav />
      <div className="plat-filters">
        <div className="field-in"><label htmlFor="pt-q">Search by name or address</label><input id="pt-q" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Team name" /></div>
        <div className="field-in"><label htmlFor="pt-s">Status</label>
          <select id="pt-s" value={status} onChange={e => changeStatus(e.target.value as TeamStatusFilter)}>{STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="field-in"><label htmlFor="pt-o">Organization</label>
          <select id="pt-o" value={org} onChange={e => setOrg(e.target.value)}>
            <option value={ORG_ALL}>All organizations</option><option value={ORG_NONE}>No organization</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}{o.enabled ? '' : ' (disabled)'} · {o.count}</option>)}
          </select></div>
      </div>
      {error && <p role="alert" className="plat-err">{error} <button type="button" className="linklike" onClick={() => void reload()}>Try again</button></p>}
      {!data && !error && <p className="muted">Loading teams…</p>}
      {data && (
        <p className="muted" role="status" style={{ fontSize: 14 }}>
          {countText(filtered.length, 'team')} shown{filtered.length !== data.total ? ` of ${data.total}` : ''}.{data.capped ? ` Only the first ${data.rows.length} were loaded; search to narrow the list.` : ''}
        </p>
      )}
      {data && filtered.length === 0 && <p className="muted">No teams match.</p>}
      {shown.length > 0 && (wide
        ? (
          <div className="table-scroll panel">
            <table className="plat-table">
              <thead><tr><th scope="col">Team</th><th scope="col">Place</th><th scope="col">Status</th><th scope="col">Organization</th><th scope="col">Roster</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
              <tbody>{shown.map(r => (
                <tr key={r.teamId}>
                  <th scope="row">{r.name}<div className="mono muted" style={{ fontSize: 12 }}>{r.slug}</div></th>
                  <td>{placeText(r) || '–'}</td><td><Badges row={r} /></td><td>{r.organization?.name ?? '–'}</td>
                  <td>{r.rosterCount}{r.captainCount === 0 ? ' · no captain' : ''}</td>
                  <td><button type="button" className="btn btn-line" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>Edit</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>)
        : (
          <ul className="plain" aria-label="Teams">{shown.map(r => (
            <li key={r.teamId} className="panel orgcard">
              <div className="orgcard-top"><b className="org-name">{r.name}</b><Badges row={r} /></div>
              <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                {[placeText(r), r.organization?.name, `${countText(r.rosterCount, 'fighter')}`, r.captainCount === 0 ? 'no captain' : null].filter(Boolean).join(' · ')}
              </p>
              <button type="button" className="btn btn-line" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>Edit team</button>
            </li>
          ))}</ul>
        ))}
      {filtered.length > shown.length && <button type="button" className="btn btn-line" onClick={() => setPages(p => p + 1)}>Show {Math.min(PAGE_SIZE, filtered.length - shown.length)} more</button>}
      {editing && <TeamEditor row={editing} onClose={() => setEditing(null)} onChanged={reload} />}
    </section>
  );
}

function TeamEditor({ row, onClose, onChanged }: { row: AdminTeamRow; onClose: () => void; onChanged: () => Promise<void> }) {
  const [saved, setSaved] = useState<TeamEditForm | null>(null);
  const [form, setForm] = useState<TeamEditForm | null>(null);
  const [logo, setLogo] = useState<string | null>(row.logoPath);
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'edit' | 'merge'>('edit');
  const [target, setTarget] = useState<{ id: string; label: string } | null>(null);
  const [auditTick, setAuditTick] = useState(0);
  const [missing, setMissing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Everything shown comes from the server; this is called on open and after every change.
  const load = useCallback(async () => {
    try {
      const f = await fetchTeamEditForm(row.teamId);
      if (!f) { setMissing(true); return; }
      setSaved(f); setForm(f); setLogo(await fetchTeamLogoPath(row.teamId));
      setRoster(await fetchTeamRoster(row.teamId).catch(() => []));
      setAuditTick(t => t + 1);
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); }
  }, [row.teamId]);
  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof TeamEditForm>(k: K, v: TeamEditForm[K]) => setForm(f => (f ? { ...f, [k]: v } : f));
  const run = async (what: () => Promise<void>, done: string) => {
    setBusy(true); setMsg(null);
    try { await what(); await load(); await onChanged(); setMsg({ ok: true, text: done }); }
    catch (e) { setMsg({ ok: false, text: friendlyError(e) }); }
    finally { setBusy(false); }
  };

  const save = () => {
    if (!form || !saved) return;
    const errs = validateTeamEdit(form);
    setErrors(errs);
    if (Object.keys(errs).length) { setMsg({ ok: false, text: 'Fix the highlighted fields first.' }); return; }
    const diff = teamEditDiff(saved, form);
    if (Object.keys(diff).length === 0) { setMsg({ ok: true, text: 'Nothing has changed.' }); return; }
    void run(() => adminUpdateTeam(row.teamId, diff), 'Saved.');
  };
  const onFile = (file: File | undefined) => {
    if (!file) return;
    const bad = validatePhotoFile(file);
    if (bad) { setMsg({ ok: false, text: bad }); return; }
    void run(async () => { await uploadTeamImage(row.teamId, 'logo', file); }, 'Logo updated.');
  };
  const doMerge = async () => {
    if (!target) return;
    setBusy(true); setMsg(null);
    try { await mergeTeams(target.id, row.teamId); await onChanged(); onClose(); }
    catch (e) { setMsg({ ok: false, text: friendlyError(e) }); setBusy(false); }
  };

  if (mode === 'merge') {
    return (
      <Dialog title={`Merge ${row.name} into another team`} variant="drawer" onClose={onClose} busy={busy}>
        <Notice lines={MERGE_TEAMS_NOTICE} />
        {target
          ? <p>Keep <b>{target.label}</b> and remove <b>{row.name}</b>. <button type="button" className="linklike" onClick={() => setTarget(null)}>Choose a different team</button></p>
          : <Picker label="Team to keep" exclude={row.teamId} search={async q => (await adminListTeams(q, 8, 0)).rows.map(t => ({ id: t.teamId, label: t.name, sub: t.slug }))} onPick={setTarget} />}
        {msg && <p role="alert" className="plat-err">{msg.text}</p>}
        <div className="dlg-actions">
          <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setMode('edit'); setMsg(null); }}>Back</button>
          <button type="button" className="btn btn-danger" disabled={busy || !target} onClick={() => void doMerge()}>{busy ? 'Merging…' : target ? `Merge into ${target.label}` : 'Merge'}</button>
        </div>
      </Dialog>
    );
  }

  const logoUrl = photoUrl(logo);
  return (
    <Dialog title={row.name} variant="drawer" onClose={onClose} busy={busy}>
      {missing && <p className="plat-err" role="alert">This team no longer exists. Close this and refresh the list.</p>}
      {!form && !missing && !msg && <p className="muted">Loading…</p>}
      {saved && <p style={{ margin: 0 }}><Badges row={{ ...row, status: saved.status }} /> <Link className="more" to={`/teams/${saved.slug}`}>View on site</Link></p>}
      {form && (
        <form onSubmit={e => { e.preventDefault(); save(); }} style={{ display: 'grid', gap: 14 }} noValidate>
          <Section title="Team">
            <TextField label="Name" value={form.name} onChange={v => set('name', v)} error={errors.name} />
            <TextField label="Team address (slug)" value={form.slug} onChange={v => set('slug', v)} error={errors.slug} hint="Used in the team's web address. Must be unique." />
            <button type="button" className="btn btn-line" onClick={() => set('slug', slugify(form.name))}>Make address from name</button>
            <SelectField label="Status" value={form.status} onChange={v => set('status', v)} error={errors.status} options={[['approved', 'Approved (public)'], ['pending', 'Pending approval']]} />
            <TextField label="Founded year" value={form.foundedYear} onChange={v => set('foundedYear', v)} error={errors.foundedYear} inputMode="numeric" maxLength={4} />
          </Section>
          <Section title="Place">
            <TextField label="City" value={form.city} onChange={v => set('city', v)} error={errors.city} />
            <TextField label="Region" value={form.region} onChange={v => set('region', v)} error={errors.region} />
            <TextField label="Country" value={form.country} onChange={v => set('country', v)} error={errors.country} />
          </Section>
          <Section title="About">
            <TextField label="Description" value={form.description} onChange={v => set('description', v)} error={errors.description} multiline maxLength={500} />
            <TextField label="Website" value={form.website} onChange={v => set('website', v)} error={errors.website} inputMode="url" />
            <TextField label="Claimed organizations (one per line, up to 5)" value={form.claimedOrganizations.join('\n')} multiline
              onChange={v => set('claimedOrganizations', v.split('\n'))} error={errors.claimedOrganizations} hint="Names the team says it belongs to. Not the same as real organization membership." />
          </Section>
          <Section title="Social links">
            {SOCIAL_NETWORKS.map(n => <TextField key={n} label={n} value={form.socialLinks[n] ?? ''} inputMode="url" onChange={v => set('socialLinks', { ...form.socialLinks, [n]: v })} />)}
            {errors.socialLinks && <span className="plat-err" style={{ fontSize: 13 }}>{errors.socialLinks}</span>}
          </Section>
          <Section title="Crest">
            <div className="plat-colors">
              {[0, 1].map(i => (
                <label key={i} className="field-in">Colour {i + 1}
                  <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(form.colors[i]) ? form.colors[i] : '#000000'} onChange={e => set('colors', (i === 0 ? [e.target.value, form.colors[1]] : [form.colors[0], e.target.value]) as [string, string])} />
                </label>
              ))}
            </div>
            {errors.colors && <span className="plat-err" style={{ fontSize: 13 }}>{errors.colors}</span>}
            <SelectField label="Crest pattern" value={form.crestDivision} onChange={v => set('crestDivision', v)} error={errors.crestDivision} options={CREST_DIVISIONS.map(d => [d, d] as const)} />
            <TextField label="Crest letters" value={form.initial} onChange={v => set('initial', v)} error={errors.initial} maxLength={2} />
          </Section>
          <div className="dlg-actions"><button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Working…' : 'Save changes'}</button></div>
        </form>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'muted' : 'plat-err'}>{msg.text}</p>}
      {form && (
        <>
          <Section title="Logo">
            {logoUrl ? <img src={logoUrl} alt={`${row.name} logo`} width={96} height={96} style={{ objectFit: 'contain', borderRadius: 8 }} /> : <p className="muted">No logo uploaded.</p>}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="dlg-actions" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => fileRef.current?.click()}>{logo ? 'Replace logo' : 'Upload logo'}</button>
              {logo && <button type="button" className="btn btn-line" disabled={busy} onClick={() => void run(() => clearTeamImage(row.teamId, 'logo'), 'Logo removed.')}>Clear logo</button>}
            </div>
          </Section>
          <Section title={`Roster${roster ? ` (${roster.length})` : ''}`}>
            {!roster && <p className="muted">Loading roster…</p>}
            {roster && roster.length === 0 && <p className="muted">No roster is shown for this team ({countText(row.rosterCount, 'fighter')} counted by the list).</p>}
            {roster && roster.length > 0 && <ul className="plain">{roster.map(m => (
              <li key={m.fighterId}><Link className="more" to={`/platform/fighters?open=${m.fighterId}`}>{m.displayName}</Link>
                <span className="muted"> {m.isCaptain ? 'captain' : m.role}{m.mercenary ? ' · mercenary' : ''} · <Link to={`/fighters/${m.fighterId}`}>public page</Link></span></li>
            ))}</ul>}
          </Section>
          <Section title="Recent changes"><AuditList subject={row.teamId} refresh={auditTick} /></Section>
          <Section title="Merge">
            <p className="muted" style={{ margin: 0 }}>Is this team a duplicate? Merge it into the team you want to keep.</p>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setMode('merge'); setMsg(null); }}>Merge into another team…</button>
          </Section>
        </>
      )}
    </Dialog>
  );
}
