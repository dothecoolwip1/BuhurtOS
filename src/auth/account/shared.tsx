import type { ReactNode } from 'react';
import { photoUrl } from '../../data/account';
import { initials } from '../../lib/accountView';

export const Err = ({ m }: { m?: string }) => (m ? <span role="alert" className="acct-err">{m}</span> : null);

/** Result line after a save: green for success, red for a problem. Announced to screen readers. */
export function Notice({ kind, children }: { kind: 'ok' | 'bad'; children: ReactNode }) {
  return <p role={kind === 'bad' ? 'alert' : 'status'} className={kind === 'bad' ? 'acct-err' : 'acct-ok'}>{children}</p>;
}

export const Counter = ({ value, max }: { value: string; max: number }) => (
  <span className={`acct-count${value.trim().length > max ? ' over' : ''}`} aria-live="polite">{value.trim().length} of {max}</span>
);

/** A stored photo, or a letters-in-a-circle fallback when there is none. Decorative unless alt is given. */
export function Avatar({ path, name, size = 96, alt }: { path: string | null; name: string; size?: number; alt?: string }) {
  const url = photoUrl(path);
  const style = { width: size, height: size, fontSize: Math.round(size / 2.6) };
  if (url) return <img className="acct-avatar" style={style} src={url} alt={alt ?? ''} loading="lazy" />;
  return <span className="acct-avatar fallback" style={style} role={alt ? 'img' : undefined} aria-label={alt} aria-hidden={alt ? undefined : true}>{initials(name)}</span>;
}
