import { describe, expect, it } from 'vitest';
import type { ManagedRegistration } from '../data/manage';
import { csvCell, exportFileName, registrationsCsv, toCsv } from './exportCsv';

const reg = (over: Partial<ManagedRegistration> = {}): ManagedRegistration => ({
  id: 'r', status: 'accepted', fullName: 'Ada Lovelace', gender: 'female', organization: 'HACSA', province: 'AB', teamName: 'Iron Wardens', sharesEquipment: false,
  days: ['sat', 'sun'], attendDates: [], availabilityNotes: 'AVAIL-NOTE', biProfile: null, insurance: 'hacsa_member', isVolunteer: false, volunteerRoles: [], mercenary: false, notes: 'FREE-NOTE',
  feeDueCents: 4000, feePaid: true, createdAt: '2026-10-01T00:00:00Z', email: 'ada@x.test', emergencyName: 'Pat Parent', emergencyRelationship: 'parent', emergencyPhone: '4035550100',
  medicalNote: 'Asthma-SECRET', categories: [{ competitionId: 'c1', name: 'Longsword', details: {} }, { competitionId: 'c2', name: 'Profight', details: { weight: '80' } }], checkedIn: true, kitPassed: false, ...over
});

describe('csvCell', () => {
  it('leaves plain text alone and writes null as empty', () => {
    expect(csvCell('Ada')).toBe('Ada');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
  });
  it('quotes commas, quotes and line breaks, doubling inner quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });
  it('defuses spreadsheet formulas with an apostrophe', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    expect(csvCell('\rcmd')).toBe('"\'\rcmd"');
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
  });
  it('does not touch a dash or equals sign that is not the first character', () => {
    expect(csvCell('Mary-Jane')).toBe('Mary-Jane');
    expect(csvCell('a=b')).toBe('a=b');
  });
});

describe('toCsv', () => {
  it('joins rows with CRLF and ends with a line break', () => {
    expect(toCsv([['a', 'b'], ['c', 'd,e']])).toBe('a,b\r\nc,"d,e"\r\n');
  });
});

describe('registrationsCsv', () => {
  it('writes a header and one row per registration', () => {
    const lines = registrationsCsv([reg(), reg({ fullName: 'Grace' })]).trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith('Name,Status,')).toBe(true);
    expect(lines[1]).toContain('Longsword; Profight (80 kg)');
    expect(lines[1]).toContain('Saturday; Sunday');
  });
  it('never contains the medical note or free-text notes, with or without emergency contacts', () => {
    for (const includeEmergency of [false, true]) {
      const out = registrationsCsv([reg()], { includeEmergency });
      expect(out).not.toContain('SECRET');
      expect(out).not.toContain('FREE-NOTE');
      expect(out).not.toContain('AVAIL-NOTE');
      expect(out.toLowerCase()).not.toContain('medical');
    }
  });
  it('leaves out emergency contacts unless asked', () => {
    const plain = registrationsCsv([reg()]);
    expect(plain).not.toContain('Pat Parent');
    expect(plain).not.toContain('4035550100');
    const withContacts = registrationsCsv([reg()], { includeEmergency: true });
    expect(withContacts).toContain('Emergency phone');
    expect(withContacts).toContain('Pat Parent');
    expect(withContacts).toContain('4035550100');
  });
  it('defuses a formula typed as a name or team', () => {
    const out = registrationsCsv([reg({ fullName: '=cmd|\' /C calc\'!A0', teamName: '@team' })]);
    expect(out).toContain('\'=cmd|\' /C calc\'!A0');
    expect(out).toContain(",'@team,");
  });
  it('shows n/a when no fee is due, and an empty list is just the header', () => {
    expect(registrationsCsv([reg({ feeDueCents: 0, feePaid: false })])).toContain('0.00,n/a');
    expect(registrationsCsv([]).trim().split('\r\n')).toHaveLength(1);
  });
});

describe('exportFileName', () => {
  it('names the file by event and date, and flags emergency contacts', () => {
    const d = new Date('2026-10-01T12:00:00Z');
    expect(exportFileName('rumble', d, false)).toBe('rumble-registrations-2026-10-01.csv');
    expect(exportFileName('rumble', d, true)).toBe('rumble-registrations-with-emergency-contacts-2026-10-01.csv');
  });
});
