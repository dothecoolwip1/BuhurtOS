import { describe, expect, it } from 'vitest';
import { sideLabel, UNNAMED_ENTRY } from './entryLabel';

describe('sideLabel', () => {
  it('uses the name when there is one', () => expect(sideLabel('e1', 'Iron Wolves', 'To be decided')).toBe('Iron Wolves'));
  it('says the team is awaiting approval when there is an id but no name', () => {
    expect(sideLabel('e1', null, 'To be decided')).toBe(UNNAMED_ENTRY);
    expect(sideLabel('e1', undefined, 'Side A')).toBe('Unnamed entry (team awaiting approval)');
  });
  it('uses the fallback when the side is not decided', () => {
    expect(sideLabel(null, null, 'To be decided')).toBe('To be decided');
    expect(sideLabel(undefined, undefined, 'Side B')).toBe('Side B');
  });
});
