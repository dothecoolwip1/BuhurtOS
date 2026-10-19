import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { fetchEditableLineup, replaceMatchEntrant, saveFieldLineup } from './organizerEdits';
import type { CompetitionMatch } from './matches';
const match = { id: 'match', version: 2, queueState: 'scheduled', planHold: false } as CompetitionMatch;
describe('organizer save acknowledgement', () => {
  beforeEach(() => rpc.mockReset());
  it('refuses stale order and entrant changes rather than reporting success', async () => {
    rpc.mockResolvedValue({ data: { status: 'stale' }, error: null });
    await expect(saveFieldLineup('event', 'Field 1', [match])).rejects.toMatchObject({ code: 'P0001' });
    await expect(replaceMatchEntrant(match, 'a', 'entry', 'injured')).rejects.toMatchObject({ code: 'P0001' });
  });
  it('requires an explicit server acknowledgement', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(saveFieldLineup('event', 'Field 1', [match])).rejects.toThrow('did not confirm');
    rpc.mockResolvedValue({ data: { status: 'ok' }, error: null });
    await expect(saveFieldLineup('event', 'Field 1', [match])).resolves.toBeUndefined();
  });
  it('only accepts a valid server editable set', async () => {
    rpc.mockResolvedValue({ data: ['match'], error: null });
    await expect(fetchEditableLineup('event', 'Field 1')).resolves.toEqual(['match']);
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchEditableLineup('event', 'Field 1')).rejects.toThrow('editable fights');
  });
  it('keeps permission failures available to the standard error display', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(replaceMatchEntrant(match, 'b', 'entry', 'injured')).rejects.toMatchObject({ code: '42501' });
  });
});
