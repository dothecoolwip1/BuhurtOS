import type { LystState } from '../../data/lyst';

/** Same operational warning as the database guard. The database decides again
 * on submission; the UI gives the operator a usable reason field beforehand. */
export function counterReviewReason(state: Pick<LystState,'server_now'|'seats'|'counter_delivery'|'counter_recovery'>, round: number): string | null {
  const official = state.seats.filter(s => s.status === 'active' && s.role === 'official');
  const now = Date.parse(state.server_now);
  const missing = official.some(s => {
    const receipt = state.counter_delivery?.find(c => c.seat_id === s.id && c.round === round);
    const reference=receipt?.run_status==='closed'&&receipt.closed_at?Date.parse(receipt.closed_at):now;
    return !receipt?.started_at || !receipt.submitted || (receipt.pending ?? 0)>0 || !receipt.seen_at || !Number.isFinite(reference)
      || !Number.isFinite(Date.parse(receipt.seen_at)) || reference-Date.parse(receipt.seen_at)>20000;
  });
  const held = state.counter_recovery?.some(e => e.round === round && e.role === 'official' && !e.decision);
  return missing || held ? 'Some counter evidence is not confirmed. Check the phones and paper sheet, then record the marshal’s reason for the awarded score.' : null;
}
