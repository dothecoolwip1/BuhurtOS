import type { ReactNode } from 'react';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="show-page-head">
    <div>{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
    {actions ? <div className="show-page-actions">{actions}</div> : null}
  </header>;
}

export function StatCard({ label, value, note, tone='default' }: { label:string; value:string|number; note?:string; tone?:'default'|'good'|'warn'|'accent' }) {
  return <article className={`show-stat ${tone}`}><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</article>;
}

export function Panel({ title, subtitle, actions, children, className='' }: { title?:string; subtitle?:string; actions?:ReactNode; children:ReactNode; className?:string }) {
  return <section className={`show-panel ${className}`}>
    {title || actions ? <div className="show-panel-head"><div>{title ? <h2>{title}</h2> : null}{subtitle ? <p>{subtitle}</p> : null}</div>{actions}</div> : null}
    {children}
  </section>;
}

export function Pill({ children, tone='neutral' }: { children:ReactNode; tone?:'neutral'|'green'|'amber'|'red'|'blue'|'purple' }) {
  return <span className={`show-pill ${tone}`}>{children}</span>;
}

export function Avatar({ initials, tone='steel', size='md' }: { initials:string; tone?:string; size?:'sm'|'md'|'lg'|'xl' }) {
  return <span className={`show-avatar ${tone} ${size}`} aria-hidden="true">{initials}</span>;
}

export function EmptyState({ icon='＋', title, text, action }: { icon?:string; title:string; text:string; action?:ReactNode }) {
  return <div className="show-empty"><span>{icon}</span><h3>{title}</h3><p>{text}</p>{action}</div>;
}
