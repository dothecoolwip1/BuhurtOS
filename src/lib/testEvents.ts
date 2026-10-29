/**
 * Test events (owner decision 2026-10-29): deleted by the daily clean-up (private.purge_test_events, pg_cron 'purge-test-events',
 * 10:23 UTC) at its first run on or after the event's test_delete_after, 10 days after creation.
 */
export const TEST_CLEANUP_UTC = { hour: 10, minute: 23 } as const;

/** When the daily clean-up will actually delete a test event that expires at `deleteAfter`. */
export function testCleanupAt(deleteAfter: string | Date): Date {
  const at = new Date(deleteAfter);
  const run = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), TEST_CLEANUP_UTC.hour, TEST_CLEANUP_UTC.minute));
  if (run.getTime() < at.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}
