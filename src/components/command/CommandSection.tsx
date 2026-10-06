import type { ReactNode } from 'react';

/**
 * One collapsible block of the Command Centre. `open` only sets the starting state: React does not touch the attribute again while the prop is
 * unchanged, so a section the person opened or closed stays that way through every live refresh.
 */
export function CommandSection({ id, title, count, countLabel, badge, open, children }: {
  id: string; title: string; count?: number; countLabel?: string; /** a short status word shown instead of a count */ badge?: string; open?: boolean; children: ReactNode;
}) {
  return (
    <details className="cc-sec panel" id={id} open={open}>
      <summary><h2 className="cc-h">{title}</h2>{badge ? <span className="cc-count">{badge}</span> : count !== undefined && <span className="cc-count">{count}{countLabel ? ` ${countLabel}` : ''}</span>}</summary>
      <div className="cc-body">{children}</div>
    </details>
  );
}
