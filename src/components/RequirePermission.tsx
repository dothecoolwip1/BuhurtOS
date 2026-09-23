import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Permission } from '../lib/permissions';
import { hasPermission } from '../lib/permissions';
import { useAppState } from '../features/AppState';

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { user,event,error }=useAppState();

  if(!event){
    return <section className="state-card"><h2>Event unavailable</h2><p>{error??'No event is selected or accessible for this account.'}</p><Link to="/ops/setup">Open setup</Link></section>;
  }

  if(!hasPermission(user,permission,event.id,event.organizationId)){
    return <section className="state-card"><span className="eyebrow">Access restricted</span><h2>You do not have permission for this workspace</h2><p>Your account is signed in, but this event role does not include the required capability.</p><Link to="/live">Open public event view</Link></section>;
  }

  return <>{children}</>;
}
