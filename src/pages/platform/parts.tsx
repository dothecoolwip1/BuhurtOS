import { useEffect, useId, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { friendlyError } from '../../lib/friendlyError';
import { auditLine, type AuditEntry } from '../../lib/platformAdmin';
import { fetchAuditFor } from '../../data/platformAdmin';

/** Small shared pieces of the owner screens. None of them grants anything: the database checks every call. */

export function PlatformNav() {
  const items: Array<[string, string, boolean]> = [['/platform', 'Overview', true], ['/platform/teams', 'Teams', false], ['/platform/fighters', 'Fighters', false], ['/platform/organizations', 'Organizations', false]];
  return (
    <nav className="plat-nav" aria-label="Platform">
      {items.map(([to, label, end]) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}
    </nav>
  );
}

export function useWide(query = '(min-width: 1000px)'): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}

/** Label, input and error text wired together. */
export function TextField({ label, value, onChange, error, hint, type = 'text', multiline = false, inputMode, maxLength, disabled }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; type?: string; multiline?: boolean;
  inputMode?: 'numeric' | 'decimal' | 'url' | 'text'; maxLength?: number; disabled?: boolean;
}) {
  const id = useId();
  const common = { id, value, disabled, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? `${id}-m` : undefined, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  return (
    <div className="field-in">
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea rows={4} maxLength={maxLength} {...common} /> : <input type={type} inputMode={inputMode} maxLength={maxLength} {...common} />}
      {(error || hint) && <span id={`${id}-m`} className={error ? 'plat-err' : 'muted'} style={{ fontSize: 13 }}>{error ?? hint}</span>}
    </div>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options, error }: { label: string; value: T; onChange: (v: T) => void; options: ReadonlyArray<readonly [T, string]>; error?: string }) {
  const id = useId();
  return (
    <div className="field-in">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {error && <span className="plat-err" style={{ fontSize: 13 }}>{error}</span>}
    </div>
  );
}

export function CheckField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="plat-check">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span><b>{label}</b>{hint && <span className="muted"> {hint}</span>}</span>
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="plat-sec"><legend>{title}</legend>{children}</fieldset>;
}

/** Search the server, pick one result. `search` must return at most a handful of rows. */
export function Picker({ label, search, onPick, exclude, placeholder = 'Type a name' }: {
  label: string; search: (q: string) => Promise<Array<{ id: string; label: string; sub?: string }>>; onPick: (r: { id: string; label: string }) => void; exclude?: string; placeholder?: string;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Array<{ id: string; label: string; sub?: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRows(null); setErr(null); return; }
    let live = true;
    const t = setTimeout(() => { search(q.trim()).then(r => { if (live) { setRows(r); setErr(null); } }, e => { if (live) setErr(friendlyError(e)); }); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, search]);
  const shown = (rows ?? []).filter(r => r.id !== exclude);
  return (
    <div className="field-in">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="search" value={q} placeholder={placeholder} autoComplete="off" onChange={e => setQ(e.target.value)} />
      {err && <span role="alert" className="plat-err" style={{ fontSize: 13 }}>{err}</span>}
      {rows && shown.length === 0 && !err && <span className="muted" style={{ fontSize: 13 }}>No matches.</span>}
      {shown.length > 0 && (
        <ul className="plain plat-pick" aria-label={`${label} results`}>
          {shown.map(r => <li key={r.id}><button type="button" className="btn btn-line" onClick={() => { onPick(r); setQ(''); setRows(null); }}><b>{r.label}</b>{r.sub && <span className="muted"> {r.sub}</span>}</button></li>)}
        </ul>
      )}
    </div>
  );
}

/** The last few audit entries for a record. Silent when the log cannot be read. */
export function AuditList({ subject, refresh }: { subject: string; refresh: number }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetchAuditFor(subject).then(r => { if (live) { setRows(r); setFailed(false); } }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [subject, refresh]);
  if (failed) return <p className="muted" style={{ fontSize: 13 }}>The change history could not be loaded.</p>;
  if (!rows) return <p className="muted" style={{ fontSize: 13 }}>Loading history…</p>;
  if (rows.length === 0) return <p className="muted" style={{ fontSize: 13 }}>No recorded changes yet.</p>;
  return (
    <ul className="plain" aria-label="Recent changes">
      {rows.map(r => { const l = auditLine(r); return (
        <li key={r.id} className="plat-audit"><b>{l.label}</b>{l.detail && <span className="muted"> {l.detail}</span>}<span className="mono muted"> {new Date(r.at).toLocaleString()}</span></li>
      ); })}
    </ul>
  );
}

export function Notice({ lines }: { lines: string[] }) {
  return <div className="plat-notice">{lines.map(l => <p key={l}>{l}</p>)}</div>;
}
