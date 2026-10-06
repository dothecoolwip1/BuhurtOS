import { describe, expect, it } from 'vitest';
import { visibleCategories } from './notificationView';

describe('visibleCategories', () => {
  it('offers all four groups to a fighter, or when roles are unknown', () => {
    expect(visibleCategories({ known: true, fighter: true, fightsInEvent: false })).toEqual(['fights', 'team', 'events', 'system']);
    expect(visibleCategories({ known: false, fighter: false, fightsInEvent: false })).toHaveLength(4);
  });
  it('leaves out fight alerts for someone who fights nowhere', () => {
    expect(visibleCategories({ known: true, fighter: false, fightsInEvent: false })).toEqual(['team', 'events', 'system']);
  });
});
