import { describe, expect, it } from 'vitest';
import { fieldLine, fieldOverview } from './fieldOverview';

const m = (field: string | null, queueState: string) => ({ field, queueState });

describe('fieldOverview', () => {
  it('counts per canonical field in natural order, including the default Lyst', () => {
    const out = fieldOverview([m('Ring 10', 'scheduled'), m('Ring 2', 'active'), m('Ring 2', 'on_deck'), m('Ring 2', 'final'), m(null, 'active'), m('Ring 1', 'in_the_hole')]);
    expect(out.map(f => f.field)).toEqual(['Field 1', 'Ring 1', 'Ring 2', 'Ring 10']);
    expect(out[2]).toEqual({ field: 'Ring 2', queued: 2, active: 1, scheduled: 0, final: 1, total: 3 });
  });
  it('merges null, blank and differently cased names of the default Lyst', () => {
    expect(fieldOverview([m(null, 'scheduled'), m(' ', 'active'), m(' FIELD 1 ', 'on_deck')])).toEqual([{field: 'Field 1', queued: 2, active: 1, scheduled: 1, final: 0, total: 3}]);
  });
});

describe('fieldLine', () => {
  it('says what is waiting', () => {
    expect(fieldLine({ field: 'A', queued: 2, active: 1, scheduled: 0, final: 0, total: 2 })).toBe('2 matches queued · 1 active');
    expect(fieldLine({ field: 'A', queued: 2, active: 2, scheduled: 0, final: 0, total: 2 })).toBe('2 matches queued · 2 active');
    expect(fieldLine({ field: 'A', queued: 1, active: 0, scheduled: 3, final: 0, total: 4 })).toBe('1 match queued');
    expect(fieldLine({ field: 'A', queued: 0, active: 0, scheduled: 3, final: 0, total: 3 })).toBe('3 scheduled, none queued yet');
    expect(fieldLine({ field: 'A', queued: 0, active: 0, scheduled: 0, final: 2, total: 2 })).toBe('All matches final');
  });
});
