import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { LEGACY_EXTRAS } from '../../lib/eventControl';
import { controlPath, legacyManageTarget } from '../../lib/eventPhaseView';

/** The extras an old Manage link carried (?match=, ?competition=, ?focus=, ?closeout=, ?created=, ?notes=) ride along unchanged. */
function withExtras(base: string, params: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const k of LEGACY_EXTRAS) { const v = params.get(k); if (v !== null) q.set(k, v); }
  const s = q.toString();
  return s ? `${base}${base.includes('?') ? '&' : '?'}${s}` : base;
}

/** `/events/:slug/manage?tab=…` (Pack 09D and earlier) → Event Control, on the mode and tool that tab became. Bookmarks and old links keep working. */
export function ManageRedirect() {
  const { eventId: slug = '' } = useParams();
  const [params] = useSearchParams();
  const { mode, tool } = legacyManageTarget(params.get('tab'));
  return <Navigate to={withExtras(controlPath(slug, mode, tool), params)} replace />;
}

/** `/events/:slug/command` (Pack 18) → Event Control › Live ops, which it became. */
export function CommandRedirect() {
  const { eventId: slug = '' } = useParams();
  return <Navigate to={controlPath(slug, 'live')} replace />;
}
