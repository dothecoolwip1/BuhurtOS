import { useRef, useState } from 'react';
import { Chip } from '../components/ui';
import { WAIVER_TEMPLATE, WAIVER_TEMPLATE_NOTICE, WAIVER_TEMPLATE_TITLE, templatePlaceholders } from '../content/waiverTemplate';
import { addWaiverPdf, addWaiverText, fetchWaiverVersions, waiverDocumentUrl, type Waiver } from '../data/setup';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { pdfWaiverProblem, textWaiverProblem, WAIVER_CHOICES, type WaiverChoice } from '../registration/waiver';

const bad: React.CSSProperties = { color: 'var(--live)' };

/** "Open the PDF" through a short-lived signed link; organizers and registrants may read it, nobody else. */
export function WaiverDocumentLink({ path, label = 'Open the PDF' }: { path: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState<string | null>(null);
  const open = async () => {
    setBusy(true); setProblem(null);
    // The tab is opened inside the tap (phone browsers block a window opened after an await), then pointed at the short-lived link.
    const tab = window.open('', '_blank');
    try {
      const url = await waiverDocumentUrl(path);
      if (tab) { tab.opener = null; tab.location.href = url; } else setReady(url);
    } catch (e) { tab?.close(); setProblem(friendlyError(e, 'Could not open the document.')); } finally { setBusy(false); }
  };
  return <>
    <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void open()}>{busy ? 'Opening…' : label}</button>
    {ready && <> <a className="btn btn-line btn-sm" href={ready} target="_blank" rel="noopener noreferrer">Open the document</a></>}
    {problem && <span role="alert" style={bad}> {problem}</span>}
  </>;
}

/**
 * The waiver people accept when they register. Three ways in: the starter template (edited before saving), the organizer's own text,
 * or an uploaded PDF. Any change is a NEW version, made on purpose; older signatures stay tied to the version they signed.
 */
export function WaiverSection({ eventId, onAdded }: { eventId: string; onAdded: () => void }) {
  const [key, setKey] = useState(0);
  const versions = useAsync(() => fetchWaiverVersions(eventId), [eventId, key]);
  const w: Waiver | undefined = versions.data?.[0];
  const [choice, setChoice] = useState<WaiverChoice | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const start = (c: WaiverChoice) => {
    setProblem(null); setFile(null); setChoice(c);
    if (c === 'template') { setTitle(WAIVER_TEMPLATE_TITLE); setBody(WAIVER_TEMPLATE); }
    else if (c === 'paste') { setTitle(w?.kind === 'text' ? w.title : 'Waiver and release'); setBody(w?.kind === 'text' ? (w.body ?? '') : ''); }
    else { setTitle(w?.title ?? 'Waiver and release'); setBody(''); }
  };
  const done = () => { setChoice(null); setKey(k => k + 1); onAdded(); };
  const saveText = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = textWaiverProblem(title, body);
    if (p) { setProblem(p); return; }
    setBusy(true); setProblem(null);
    try { await addWaiverText(eventId, title, body, choice === 'template' ? 'template' : 'pasted'); done(); }
    catch (x) { setProblem(friendlyError(x, 'Could not save the waiver.')); } finally { setBusy(false); }
  };
  const saveFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = pdfWaiverProblem(file) ?? (title.trim().length < 3 ? 'Give the waiver a title.' : null);
    if (p || !file) { setProblem(p); return; }
    setBusy(true); setProblem(null);
    try { await addWaiverPdf(eventId, title, file, body.trim() || null); done(); }
    catch (x) { setProblem(friendlyError(x, 'Could not upload the waiver.')); } finally { setBusy(false); }
  };
  const placeholders = choice === 'template' ? templatePlaceholders(body) : [];
  const nextVersion = (w?.version ?? 0) + 1;

  return (
    <section className="panel info" aria-labelledby="waiver-h" id="waiver" style={{ display: 'grid', gap: 12, scrollMarginTop: 96 }}>
      <h3 id="waiver-h">Waiver {versions.data && <Chip tone={w ? 'win' : 'brass'}>{w ? `version ${w.version}` : 'none yet'}</Chip>}</h3>
      {versions.loading && !versions.data && <p className="muted">Loading…</p>}
      {versions.error != null && <p role="alert" style={bad}>{friendlyError(versions.error, 'Could not load the waiver.')}</p>}
      {versions.data && !w && !choice && <p>Everyone who registers must accept a waiver, so the event cannot be published without one. Choose how to add yours:</p>}
      {w && !choice && (
        <div style={{ display: 'grid', gap: 6 }}>
          <p style={{ margin: 0 }}><b>{w.title}</b> <span className="src">· version {w.version}{w.kind === 'pdf' ? ' · PDF' : ''}{w.source === 'template' ? ' · from the starter template' : ''}</span></p>
          {w.kind === 'pdf' && w.documentPath && <p style={{ margin: 0 }}><WaiverDocumentLink path={w.documentPath} /> {w.body && <span className="src">{w.body}</span>}</p>}
          {w.kind === 'text' && <details><summary>Read the text</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8 }}>{w.body}</p></details>}
          <p className="src" style={{ margin: 0 }}>Registrations record the exact version each person accepted. Changing the waiver makes version {nextVersion}; nobody's earlier signature is touched.</p>
        </div>
      )}
      {!choice && (
        <div style={{ display: 'grid', gap: 8 }} role="group" aria-label={w ? 'Replace the waiver with a new version' : 'Add the waiver'}>
          {w && <p className="eyebrow" style={{ margin: 0 }}>New version</p>}
          <div className="choice3">
            {WAIVER_CHOICES.map(([k, label, hint]) => (
              <button key={k} type="button" className="panel choicebtn" data-testid={`waiver-${k}`} onClick={() => start(k)}><b>{label}</b><span className="muted">{hint}</span></button>
            ))}
          </div>
        </div>
      )}

      {(choice === 'template' || choice === 'paste') && (
        <form onSubmit={e => void saveText(e)} style={{ display: 'grid', gap: 10 }} aria-label={choice === 'template' ? 'Starter template' : 'Your waiver text'}>
          {choice === 'template' && <p role="note" className="panel" style={{ padding: 12, margin: 0, borderLeft: '4px solid var(--brass)' }}><b>Starter waiver template.</b> {WAIVER_TEMPLATE_NOTICE}</p>}
          <label className="field-in">Title<input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} /></label>
          <label className="field-in">Full text people agree to
            <textarea rows={14} value={body} onChange={e => setBody(e.target.value)} />
            <span>{choice === 'template' ? (placeholders.length ? `Replace ${placeholders.join(', ')} before saving.` : 'Every placeholder is replaced. Read it through once more.') : 'BuhurtOS does not write or check waiver wording. Use the text your organization or insurer gives you.'}</span>
          </label>
          <p className="src">Saving makes this version {nextVersion}. People who already registered keep the version they signed; new registrations accept this one.</p>
          {problem && <p role="alert" style={bad}>{problem}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-ink" disabled={busy} data-testid="save-waiver">{busy ? 'Saving…' : `Save as version ${nextVersion}`}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setChoice(null)}>Cancel</button>
          </div>
        </form>
      )}

      {choice === 'upload' && (
        <form onSubmit={e => void saveFile(e)} style={{ display: 'grid', gap: 10 }} aria-label="Upload a waiver PDF">
          <label className="field-in">Title (shown to people when they register)<input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} /></label>
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={e => { setFile(e.target.files?.[0] ?? null); setProblem(null); }} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-line" onClick={() => input.current?.click()}>{file ? 'Choose another PDF' : 'Choose a PDF'}</button>
            {file && <span style={{ overflowWrap: 'anywhere' }}><b>{file.name}</b> <span className="src">({Math.max(1, Math.round(file.size / 1024))} KB)</span></span>}
          </div>
          <label className="field-in">Short note shown with the document (optional)
            <input value={body} maxLength={300} onChange={e => setBody(e.target.value)} placeholder="For example: the HACSA 2026 waiver, 3 pages" />
          </label>
          <p className="src">People read the PDF on the registration form, then confirm and type their name. The file is kept privately in BuhurtOS storage; only this event's organizers and people reading the waiver can open it. Saving makes this version {nextVersion}.</p>
          {problem && <p role="alert" style={bad}>{problem}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-ink" disabled={busy || !file} data-testid="save-waiver">{busy ? 'Uploading…' : `Upload as version ${nextVersion}`}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setChoice(null)}>Cancel</button>
          </div>
        </form>
      )}

      {(versions.data?.length ?? 0) > 1 && (
        <div>
          <button type="button" className="linklike" onClick={() => setShowHistory(s => !s)}>{showHistory ? 'Hide' : 'Show'} earlier versions ({versions.data!.length - 1})</button>
          {showHistory && (
            <ul className="plain" style={{ marginTop: 8 }}>
              {versions.data!.slice(1).map(v => (
                <li key={v.id}><b>Version {v.version}</b> · {v.title}{v.kind === 'pdf' ? ' · PDF' : ''} <span className="src">· {new Date(v.createdAt).toLocaleDateString('en-CA')}</span>
                  {v.kind === 'pdf' && v.documentPath && <> <WaiverDocumentLink path={v.documentPath} label="Open" /></>}
                  {v.kind === 'text' && <details><summary>Text</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{v.body}</p></details>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
