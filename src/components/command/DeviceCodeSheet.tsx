import { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Dialog } from '../Dialog';
import { accessEndsLabel, deviceQrUrl, roleWord } from '../../lib/devices';
import '../../styles/command181.css';

/** One code to hand over. It exists only inside the sheet: the caller drops it the moment the sheet closes. */
export interface CodeItem { label: string; role: string; code: string; expiresAt: string | null }

function Qr({ url, label }: { url: string; label: string }) {
  const svg = useMemo(() => {
    try { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch { return ''; }
  }, [url]);
  // the markup comes from the QR library for OUR url only; it holds shapes, never text
  return svg ? <div className="dev-qr" role="img" aria-label={`QR code to sign in ${label}`} dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="src">The QR could not be drawn. Type the code instead.</p>;
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * The one moment a device code is on screen. Big grouped code, a QR (the code rides in the link's FRAGMENT only), a copy button and a print button.
 * A code is never shown again: closing the sheet drops it (nothing stores it), and the only way to get another is a new code for that device.
 * One item is a single device; several are the printable "usual set" (one card per device).
 */
export function DeviceCodeSheet({ title, items, eventName, timezone, notes, onClose }: {
  title: string; items: CodeItem[]; eventName: string; timezone: string; notes?: string[]; onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    // leave the page behind us as we found it if the person prints and closes
    const done = () => document.body.classList.remove('printing-codes');
    window.addEventListener('afterprint', done);
    return () => { window.removeEventListener('afterprint', done); done(); };
  }, []);

  const origin = window.location.origin, base = import.meta.env.BASE_URL ?? '/';
  const where = `${origin}${base.endsWith('/') ? base : `${base}/`}device`;
  const many = items.length > 1;
  const copy = async (key: string, text: string) => {
    const ok = await copyText(text);
    setCopyFailed(!ok);
    setCopied(ok ? key : null);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 4000);
  };
  const print = () => { document.body.classList.add('printing-codes'); window.print(); };

  return (
    <Dialog title={title} onClose={onClose}>
      <div className={`dev-sheet${many ? ' is-set' : ''}`} data-testid="code-sheet">
        <p className="dev-once" role="alert"><b>This code will not be shown again.</b> Copy it, scan it or print it now. If it is lost, make a new code for that device: the old one stops working.</p>
        {notes && notes.length > 0 && <ul className="dev-notes">{notes.map(n => <li key={n}>{n}</li>)}</ul>}
        <p className="dev-print-title">{eventName}: temporary device codes</p>
        <ul className="dev-cards">
          {items.map(it => {
            const ends = accessEndsLabel(it.expiresAt, timezone);
            let url = '';
            try { url = deviceQrUrl(origin, base, it.code); } catch { url = ''; }
            return (
              <li key={it.label} className="dev-card" data-testid="code-card">
                <h3 className="dev-card-label">{it.label}</h3>
                <p className="dev-card-role">{roleWord(it.role)}</p>
                <p className="dev-code" data-testid="device-code">{it.code}</p>
                {url && <Qr url={url} label={it.label} />}
                <p className="dev-how">Scan with the phone camera, or open <b>{where}</b> and type the code.</p>
                {ends && <p className="dev-ends">{ends}</p>}
                <div className="dev-noprint">
                  <button type="button" className="btn btn-line" onClick={() => void copy(it.label, it.code)}>{copied === it.label ? 'Copied' : many ? `Copy code · ${it.label}` : 'Copy code'}</button>
                </div>
              </li>
            );
          })}
        </ul>
        {copyFailed && <p role="alert" className="err dev-noprint">This browser would not copy it. Select the code and copy it by hand.</p>}
        <div className="dlg-actions dev-noprint">
          {many && <button type="button" className="btn btn-line" onClick={() => void copy('all', items.map(i => `${i.label}: ${i.code}`).join('\n'))}>{copied === 'all' ? 'Copied' : 'Copy all codes'}</button>}
          <button type="button" className="btn btn-line" onClick={print}>Print {many ? 'these codes' : 'this code'}</button>
          <button type="button" className="btn btn-ink" data-autofocus onClick={onClose}>Done: I have saved {many ? 'them' : 'it'}</button>
        </div>
      </div>
    </Dialog>
  );
}
