import { describe, expect, it, vi } from 'vitest';
import { shareLink } from './share';

const data = { title: 'Rumble', url: 'https://example.test/events/rumble' };

describe('shareLink', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareLink(data, { share, writeText })).toBe('shared');
    expect(share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
  });
  it('treats closing the share sheet as cancelled, not as an error', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    const writeText = vi.fn();
    expect(await shareLink(data, { share, writeText })).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });
  it('copies the link when sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(data, { writeText })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
  });
  it('copies the link when sharing fails for another reason', async () => {
    const share = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(data, { share, writeText })).toBe('copied');
  });
  it('reports failure when nothing works', async () => {
    expect(await shareLink(data, {})).toBe('failed');
    expect(await shareLink(data, { writeText: vi.fn().mockRejectedValue(new Error('denied')) })).toBe('failed');
  });
});
