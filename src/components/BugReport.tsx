import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { sendBugReport, validateBug, type BugInput } from '../data/admin';
import { friendlyError } from '../lib/friendlyError';
import { Dialog } from './Dialog';

const empty: BugInput = { what: '', expected: '', contact: '', screenshot: null };

/** Header button on every page: report a problem with this page. Page, app version and device are attached for you. */
export function BugReportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="icon-btn" aria-label="Report a bug" title="Report a bug" onClick={() => setOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 8.5V7a4 4 0 0 1 8 0v1.5" /><rect x="7" y="8.5" width="10" height="11" rx="5" /><path d="M12 12v7.5M3 13h4M17 13h4M4 7.5l3 2M20 7.5l-3 2M4 19l3-2M20 19l-3-2" />
        </svg>
      </button>
      {open && <BugDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function BugDialog({ onClose }: { onClose: () => void }) {
  const { pathname, search } = useLocation();
  const { session } = useAuth();
  const [b, setB] = useState<BugInput>(empty);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const error = validateBug(b);
  const set = <K extends keyof BugInput>(k: K, v: BugInput[K]) => setB(p => ({ ...p, [k]: v }));

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    if (error) return;
    setBusy(true);
    try { await sendBugReport(b, pathname + search); setDone(true); }
    catch (x) { setProblem(x instanceof Error && !('code' in x) ? x.message : friendlyError(x, 'Could not send the report. Try again in a moment.')); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title={done ? 'Thanks!' : 'Report a bug'} variant="drawer" onClose={onClose} busy={busy}>
      {done ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <p>Got it. Your report went straight to the BuhurtOS team, with the page you were on and your device.</p>
          <div className="formactions"><button type="button" className="btn btn-ink" onClick={onClose}>Close</button></div>
        </div>
      ) : (
        <form onSubmit={e => void send(e)} noValidate style={{ display: 'grid', gap: 14 }}>
          <p className="src">About this page: <b>{pathname}</b>. The page, app version and your screen size are sent with it.</p>
          <label className="field-in">What went wrong?
            <textarea rows={4} value={b.what} autoFocus onChange={e => set('what', e.target.value)} placeholder="For example: I tapped Save and nothing happened" aria-invalid={Boolean(show && error)} />
          </label>
          <label className="field-in">What did you expect? (optional)
            <textarea rows={2} value={b.expected} onChange={e => set('expected', e.target.value)} />
          </label>
          <div className="field-in">Screenshot (optional)
            <input ref={file} type="file" accept="image/*" hidden onChange={e => set('screenshot', e.target.files?.[0] ?? null)} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-line btn-sm" onClick={() => file.current?.click()}>{b.screenshot ? 'Change screenshot' : 'Add a screenshot'}</button>
              {b.screenshot && <span className="src" style={{ overflowWrap: 'anywhere' }}>{b.screenshot.name} <button type="button" className="linklike" onClick={() => { set('screenshot', null); if (file.current) file.current.value = ''; }}>Remove</button></span>}
            </div>
            <span>Only the BuhurtOS team can see it.</span>
          </div>
          {!session && (
            <label className="field-in">Your email, if you'd like a reply (optional)
              <input type="email" inputMode="email" autoComplete="email" value={b.contact} onChange={e => set('contact', e.target.value)} />
            </label>
          )}
          {show && error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
          {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
          <div className="formactions">
            <button type="button" className="btn btn-line" disabled={busy} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
