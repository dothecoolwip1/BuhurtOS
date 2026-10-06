import { describe, expect, it } from 'vitest';
import { formatDeviceCode, formatTyping, normalizeDeviceCode, parseCodeFragment } from './deviceCode';

describe('normalizeDeviceCode', () => {
  it('accepts any case, dashes and spaces', () => {
    expect(normalizeDeviceCode('K7Q2-M9XD-4TRH')).toBe('K7Q2M9XD4TRH');
    expect(normalizeDeviceCode('k7q2 m9xd 4trh')).toBe('K7Q2M9XD4TRH');
    expect(normalizeDeviceCode('  k7q2m9xd4trh ')).toBe('K7Q2M9XD4TRH');
  });
  it('reads O as 0 and I or L as 1', () => {
    expect(normalizeDeviceCode('OOOO-IIII-LLLL')).toBe('000011111111');
  });
  it('refuses wrong lengths, the letter U and other characters', () => {
    expect(normalizeDeviceCode('K7Q2-M9XD-4TR')).toBeNull();
    expect(normalizeDeviceCode('K7Q2-M9XD-4TRHH')).toBeNull();
    expect(normalizeDeviceCode('K7Q2-M9XD-4TRU')).toBeNull();
    expect(normalizeDeviceCode('K7Q2-M9XD-4TR!')).toBeNull();
    expect(normalizeDeviceCode('')).toBeNull();
    expect(normalizeDeviceCode(undefined)).toBeNull();
    expect(normalizeDeviceCode('A'.repeat(200))).toBeNull();
  });
});

describe('formatDeviceCode / formatTyping', () => {
  it('shows XXXX-XXXX-XXXX', () => { expect(formatDeviceCode('k7q2m9xd4trh')).toBe('K7Q2-M9XD-4TRH'); });
  it('leaves a partial code alone', () => { expect(formatDeviceCode('K7Q2')).toBe('K7Q2'); });
  it('tidies as the person types', () => {
    expect(formatTyping('k7q')).toBe('K7Q');
    expect(formatTyping('k7q2m')).toBe('K7Q2-M');
    expect(formatTyping('k7q2m9xd4trhZZZ')).toBe('K7Q2-M9XD-4TRH');
    expect(formatTyping('k7q2-m9xd')).toBe('K7Q2-M9XD');
    expect(formatTyping('oil u')).toBe('011');
  });
});

describe('parseCodeFragment', () => {
  it('reads the QR fragment', () => {
    expect(parseCodeFragment('#c=K7Q2M9XD4TRH')).toBe('K7Q2M9XD4TRH');
    expect(parseCodeFragment('c=k7q2-m9xd-4trh')).toBe('K7Q2M9XD4TRH');
    expect(parseCodeFragment('#x=1&c=K7Q2M9XD4TRH')).toBe('K7Q2M9XD4TRH');
  });
  it('ignores anything that is not a valid code', () => {
    expect(parseCodeFragment('')).toBeNull();
    expect(parseCodeFragment('#')).toBeNull();
    expect(parseCodeFragment('#c=')).toBeNull();
    expect(parseCodeFragment('#c=SHORT')).toBeNull();
    expect(parseCodeFragment('#code=K7Q2M9XD4TRH')).toBeNull();
    expect(parseCodeFragment('#c=%E0%A4%A')).toBeNull();
  });
});
