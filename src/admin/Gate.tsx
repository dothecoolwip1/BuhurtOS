import type { ReactNode } from 'react';
import { useAdmin } from './AdminContext';
import { ROLE_LABEL, type Role } from './data';

/** Preview of a permission-failure screen. In the real app the database refuses the request; this only explains it. */
export function Gate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useAdmin();
  if (roles.includes(role)) return <>{children}</>;
  return (
    <div className="panel info" style={{ gap: 10 }}>
      <h3>Your role cannot use this page</h3>
      <p style={{ color: 'var(--muted)' }}>You are signed in as <b>{ROLE_LABEL[role]}</b>. This page is for {roles.map(r => ROLE_LABEL[r]).join(' or ')}. The database refuses these requests even if a link is shared, so nothing here depends on hiding the menu.</p>
    </div>
  );
}

export function Head({ title, lede, children }: { title: string; lede?: string; children?: ReactNode }) {
  return (
    <div className="pagehead">
      <div><h1>{title}</h1>{lede && <p>{lede}</p>}</div>
      {children && <div className="acts">{children}</div>}
    </div>
  );
}
