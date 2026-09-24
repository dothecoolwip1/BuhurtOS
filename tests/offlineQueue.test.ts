import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discardMutation,
  enqueueMutation,
  flushMutationQueue,
  listMutations,
  retryMutation
} from '../src/lib/offlineQueue';

async function clearQueue() {
  for (const item of await listMutations()) await discardMutation(item.id);
}

describe('offline mutation queue hardening', () => {
  beforeEach(clearQueue);
  afterEach(clearQueue);

  it('preserves conflicts until a person explicitly retries them', async () => {
    const queued = await enqueueMutation({
      entity: 'match_status',
      entityId: 'match-1',
      operation: 'rpc',
      payload: { status: 'active' },
      baseVersion: 'scheduled'
    });

    const first = await flushMutationQueue(async () => ({
      ok: false as const,
      conflict: true,
      error: 'Match changed on another device.'
    }));

    expect(first).toEqual({ synced: 0, conflicts: 1, failed: 0 });
    expect(await listMutations()).toMatchObject([{
      id: queued.id,
      state: 'conflict',
      attempts: 1,
      lastError: 'Match changed on another device.'
    }]);

    const skipped = await flushMutationQueue(async () => ({ ok: true as const }));
    expect(skipped).toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(await listMutations()).toHaveLength(1);

    await retryMutation(queued.id);
    const retried = await flushMutationQueue(async () => ({ ok: true as const }));
    expect(retried).toEqual({ synced: 1, conflicts: 0, failed: 0 });
    expect(await listMutations()).toEqual([]);
  });

  it('retains unexpected sync failures instead of dropping field work', async () => {
    const queued = await enqueueMutation({
      entity: 'event_roster_entries',
      entityId: 'roster-1',
      operation: 'update',
      payload: { checkedIn: true },
      baseVersion: JSON.stringify({ updatedAt: '2026-09-24T12:00:00Z' })
    });

    const result = await flushMutationQueue(async () => {
      throw new Error('Temporary network failure');
    });

    expect(result).toEqual({ synced: 0, conflicts: 0, failed: 1 });
    expect(await listMutations()).toMatchObject([{
      id: queued.id,
      state: 'failed',
      attempts: 1,
      lastError: 'Temporary network failure'
    }]);
  });
});
