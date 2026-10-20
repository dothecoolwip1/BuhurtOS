import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { newGroupFight } from './scoring';
import { loadBoard, saveBoard } from './boardStore';

it('retains a retry command during scoring but durably clears it when recorded rounds repair the board', async () => {
  const board = { mode: 'group' as const, s: newGroupFight() };
  await saveBoard('scorer', 'event', 'repaired-team', board, { finalizeCommandId: 'old-proposal' });
  await saveBoard('scorer', 'event', 'repaired-team', board);
  expect((await loadBoard('scorer', 'event', 'repaired-team', 'group'))?.finalizeCommandId).toBe('old-proposal');
  await saveBoard('scorer', 'event', 'repaired-team', board, { finalizeCommandId: null });
  vi.resetModules(); // Reload with an empty memory cache, as after closing the tab.
  const reopened = await import('./boardStore');
  const stored = await reopened.loadBoard('scorer', 'event', 'repaired-team', 'group');
  expect(stored?.board).toEqual(board);
  expect(stored?.finalizeCommandId).toBeUndefined();
});
