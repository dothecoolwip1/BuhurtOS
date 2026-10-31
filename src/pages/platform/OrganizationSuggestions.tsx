import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from '../../components/Dialog';
import { Chip, Seg } from '../../components/ui';
import {
  approveFormFrom, decideSuggestion, fetchAdminSuggestions, involvementLabel, KIND_OPTIONS, kindLabel, SLUG_RE, statusText,
  type AdminSuggestion, type ApproveForm
} from '../../data/organizationSuggestions';
import { friendlyError } from '../../lib/friendlyError';
import { timeAgo } from '../../lib/notificationView';
import { useAsync } from '../../lib/useAsync';

const bad: React.CSSProperties = { color: 'var(--live)' };
const FILTERS = [['pending', 'Waiting'], ['approved', 'Added'], ['declined', 'Not added'], ['all', 'All']] as const;
type Filter = (typeof FILTERS)[number][0];

/** Owner: organizations people suggested. Approving creates the organization from the checked fields; nothing is deleted either way. */
export function OrganizationSuggestions({ onCreated }: { onCreated: () => Promise<void> }) {
  const [filter, setFilter] = useState<Filter>('pending');
  const [key, setKey] = useState(0);
  const [deciding, setDeciding] = useState<{ s: AdminSuggestion; mode: 'approve' | 'decline' } | null>(null);
  const list = useAsync(() => fetchAdminSuggestions(filter === 'all' ? null : filter), [filter, key]);
  const rows = list.data ?? [];
  return (
    <section aria-labelledby="org-sugg" style={{ display: 'grid', gap: 12 }}>
      <h2 id="org-sugg">Suggested organizations</h2>
      <Seg scroll label="Show" value={filter} options={FILTERS} onChange={setFilter} />
      {list.error != null && <p role="alert" className="plat-err">{friendlyError(list.error, 'Could not load suggestions.')}</p>}
      {list.loading && !list.data && <p className="muted">Loading…</p>}
      {!list.loading && !list.error && rows.length === 0 && <p className="muted">{filter === 'pending' ? 'Nothing waiting for review.' : 'Nothing here.'}</p>}
      <ul className="plain" style={{ display: 'grid', gap: 12 }}>
        {rows.map(s => <li key={s.id}><SuggestionCard s={s} onDecide={mode => setDeciding({ s, mode })} /></li>)}
      </ul>
      {deciding && (
        <DecideDialog s={deciding.s} mode={deciding.mode} onClose={() => setDeciding(null)}
          onDone={async created => { setDeciding(null); setKey(k => k + 1); if (created) await onCreated(); }} />
      )}
    </section>
  );
}

function SuggestionCard({ s, onDecide }: { s: AdminSuggestion; onDecide: (mode: 'approve' | 'decline') => void }) {
  const who = s.personName || s.email || 'Account removed';
  return (
    <article className="panel info" style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ overflowWrap: 'anywhere' }}>{s.organizationSlug ? <Link to={`/organizations/${s.organizationSlug}`}>{s.name}</Link> : s.name}</b>
        {s.shortName && <span className="mono">{s.shortName}</span>}
        <Chip tone={s.status === 'approved' ? 'win' : s.status === 'pending' ? 'brass' : ''}>{statusText(s.status)}</Chip>
      </div>
      <p className="muted">{[kindLabel(s.kind), s.region, s.country].filter(Boolean).join(' · ')}</p>
      {s.website && <p style={{ overflowWrap: 'anywhere' }}><a href={s.website} target="_blank" rel="noopener noreferrer nofollow">{s.website}</a></p>}
      {s.description && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{s.description}</p>}
      <p className="src" style={{ overflowWrap: 'anywhere' }}>{timeAgo(s.createdAt)} · {who}{s.email && s.personName ? ` (${s.email})` : ''} · {involvementLabel(s.involvement)}</p>
      {s.note && <p className="muted" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><b>Note:</b> {s.note}</p>}
      {s.decisionNote && <p className="muted" style={{ overflowWrap: 'anywhere' }}><b>Your reply:</b> {s.decisionNote}</p>}
      {s.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ink btn-sm" onClick={() => onDecide('approve')}>Check and add</button>
          <button type="button" className="btn btn-line btn-sm" onClick={() => onDecide('decline')}>Don't add</button>
        </div>
      )}
    </article>
  );
}

function DecideDialog({ s, mode, onClose, onDone }: { s: AdminSuggestion; mode: 'approve' | 'decline'; onClose: () => void; onDone: (created: boolean) => Promise<void> }) {
  const [f, setF] = useState<ApproveForm>(() => approveFormFrom(s));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof ApproveForm>(k: K, v: ApproveForm[K]) => setF(p => ({ ...p, [k]: v }));
  const approve = mode === 'approve';
  const slugOk = SLUG_RE.test(f.slug.trim());
  const nameOk = f.name.trim().length >= 2;

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (approve && (!slugOk || !nameOk)) { setProblem(!nameOk ? 'Give the organization a name.' : 'The web address uses lower-case letters, numbers and single dashes.'); return; }
    setBusy(true); setProblem(null);
    try { await decideSuggestion(s.id, approve ? 'approved' : 'declined', note, approve ? f : null); await onDone(approve); }
    catch (x) { setProblem(friendlyError(x)); setBusy(false); }
  };

  return (
    <Dialog title={approve ? `Add ${s.name}` : `Don't add ${s.name}`} onClose={onClose} busy={busy}>
      <form onSubmit={e => void go(e)} noValidate style={{ display: 'grid', gap: 12 }}>
        {approve ? (
          <>
            <p className="muted">This creates the organization, switched on, exactly as below. You can still change it later.</p>
            <label className="field-in">Name<input value={f.name} onChange={e => set('name', e.target.value)} /></label>
            <label className="field-in">Short name (optional)<input value={f.shortName} onChange={e => set('shortName', e.target.value)} /></label>
            <label className="field-in">Web address: buhurt-os.app/organizations/{f.slug.trim() || '…'}
              <input value={f.slug} onChange={e => set('slug', e.target.value.toLowerCase())} aria-invalid={!slugOk} autoCapitalize="none" spellCheck={false} />
            </label>
            <label className="field-in">Kind<select value={f.kind} onChange={e => set('kind', e.target.value as ApproveForm['kind'])}>{KIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="field-in">Country<input value={f.country} onChange={e => set('country', e.target.value)} /></label>
            <label className="field-in">Province or state<input value={f.region} onChange={e => set('region', e.target.value)} /></label>
            <label className="field-in">Website<input value={f.website} onChange={e => set('website', e.target.value)} inputMode="url" /></label>
            <label className="field-in">Description<textarea rows={3} value={f.description} onChange={e => set('description', e.target.value)} /></label>
            <label className="check-row"><input type="checkbox" checked={f.makeAdmin} onChange={e => set('makeAdmin', e.target.checked)} disabled={!s.personName && !s.email} />
              <span>Make {s.personName || s.email || 'the person who suggested it'} an admin of it ({involvementLabel(s.involvement).toLowerCase()})</span></label>
          </>
        ) : <p className="muted">The suggestion is kept, marked as not added. The person who sent it is told.</p>}
        <label className="field-in">Message to the person who suggested it (optional)
          <textarea rows={2} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder={approve ? 'Welcome aboard' : 'For example: we could not find this club'} />
        </label>
        {problem && <p role="alert" style={bad}>{problem}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Saving…' : approve ? 'Add organization' : "Don't add"}</button>
          <button type="button" className="btn btn-line" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
