import { describe, expect, it } from 'vitest';
import { fitWithin, MAX_PHOTO_EDGE } from './imageResize';

describe('fitWithin', () => {
  it('leaves small images alone and never enlarges', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(fitWithin(MAX_PHOTO_EDGE, 10)).toEqual({ width: MAX_PHOTO_EDGE, height: 10, scaled: false });
  });
  it('scales the longer edge down to the limit, keeping the shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200, scaled: true });
    expect(fitWithin(3000, 6000, 1600)).toEqual({ width: 800, height: 1600, scaled: true });
  });
  it('never returns less than one pixel and survives bad input', () => {
    expect(fitWithin(100000, 10, 1600).height).toBe(1);
    expect(fitWithin(0, 5)).toEqual({ width: 1, height: 1, scaled: false });
    expect(fitWithin(NaN, 5).scaled).toBe(false);
  });
});
