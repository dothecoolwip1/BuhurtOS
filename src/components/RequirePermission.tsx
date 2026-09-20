import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Permission } from '../lib/permissions';
import { hasPermission } from '../lib/permissions';
import { useAppState } from '../features/AppState';

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { user, event, error } = useAppState();
  if (!event && error) return <Navigate to="/setup" replace />;
  if (!event) return <div className="state-card">Loading access…</div>;
  if (!hasPermission(user, permission, event.id, event.organizationId)) return <Navigate to="/public" replace />;
  return <>{children}</>;
}
