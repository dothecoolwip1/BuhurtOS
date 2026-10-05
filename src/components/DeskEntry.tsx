import { Link } from 'react-router-dom';

/** Mirrors private.can_see_readiness_detail plus the platform owner; the desk asks the database again before showing anything. */
export const DESK_ROLES = ['organizer', 'head_marshal', 'check_in', 'inspector', 'owner'];
export const canUseDesk = (roles: readonly string[] | undefined): boolean => Boolean(roles?.some(r => DESK_ROLES.includes(r)));

/** The way onto the check-in desk for the people who staff it (Pack 16). */
export function DeskEntry({ slug, roles }: { slug: string; roles: readonly string[] | undefined }) {
  if (!canUseDesk(roles)) return null;
  return (
    <section className="panel info" aria-labelledby="desk-h" style={{ display: 'grid', gap: 10 }}>
      <h3 id="desk-h">Check-in and armour</h3>
      <p className="src">Check fighters in, record armour inspections and see who is ready to fight.</p>
      <p><Link className="btn btn-ink" to={`/events/${slug}/checkin`} data-testid="open-desk">Open the check-in desk</Link></p>
    </section>
  );
}
