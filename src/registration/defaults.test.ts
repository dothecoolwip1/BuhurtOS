import { describe, expect, it } from 'vitest';
import { applyDefaults, provinceCode } from './defaults';
import { categoriesFor, emptyForm, genderAllows, genderRuleText, validate, type CompetitionOption } from './model';

const comps: CompetitionOption[] = [
  { id: 'm', name: 'Men Longsword', category: 'longsword', league: 'duels', gender: 'men' },
  { id: 'w', name: 'Women Longsword', category: 'longsword', league: 'duels', gender: 'women' },
  { id: 'o', name: 'Open Longsword', category: 'longsword', league: 'duels', gender: 'open' }
];

describe('gender decides which categories apply', () => {
  it('male: men\'s and open only; female: women\'s and open only; other: everything; nothing chosen yet: nothing', () => {
    expect(categoriesFor('male', comps).map(c => c.id)).toEqual(['m', 'o']);
    expect(categoriesFor('female', comps).map(c => c.id)).toEqual(['w', 'o']);
    expect(categoriesFor('other', comps).map(c => c.id)).toEqual(['m', 'w', 'o']);
    expect(categoriesFor('', comps)).toEqual([]);
    expect(genderAllows('male', { gender: 'women' })).toBe(false);
  });
  it('says what is being shown', () => {
    expect(genderRuleText('male')).toMatch(/men's and open/);
    expect(genderRuleText('')).toMatch(/Choose your gender/);
  });
  it('validation refuses a category the chosen gender cannot enter', () => {
    const f = { ...emptyForm('a@b.co'), gender: 'male' as const, competitionIds: ['w'] };
    expect(validate(f, comps, { feeCents: 0, feeProvince: null }).competitionIds).toMatch(/Women Longsword is not open/);
    expect(validate({ ...f, competitionIds: ['m'] }, comps, { feeCents: 0, feeProvince: null }).competitionIds).toBeUndefined();
    expect(validate({ ...f, gender: 'other', competitionIds: ['w'] }, comps, { feeCents: 0, feeProvince: null }).competitionIds).toBeUndefined();
  });
});

describe('registration defaults come from what BuhurtOS already knows', () => {
  it('turns a province name or code into the code, and anything else into nothing', () => {
    expect(provinceCode('Alberta')).toBe('AB'); expect(provinceCode(' ab ')).toBe('AB'); expect(provinceCode('Texas')).toBe(''); expect(provinceCode(null)).toBe('');
  });
  it('fills an empty form from the last registration first, then the fighter profile, then the account', () => {
    const { form, filled } = applyDefaults(emptyForm('me@x.co'), {
      account: { displayName: 'Garrett R', region: 'Alberta' },
      fighter: { gender: 'male', teamId: 't1', region: 'AB' },
      last: { fullName: 'Garrett Robson', gender: 'male', organization: 'HACSA', province: 'AB', teamId: 't2', biProfile: 'BI-1', sharesEquipment: false, emergencyName: 'Pat', emergencyRelationship: 'Sister', emergencyPhone: '403 555 0100' }
    }, ['t1', 't2']);
    expect(form).toMatchObject({ fullName: 'Garrett Robson', gender: 'male', organization: 'HACSA', province: 'AB', teamId: 't2', biProfile: 'BI-1', sharesEquipment: 'no', emergencyName: 'Pat', emergencyPhone: '403 555 0100' });
    expect(filled).toEqual(expect.arrayContaining(['name', 'gender', 'organization', 'province', 'team', 'emergency contact']));
  });
  it('falls back to the fighter profile and the account when there is no earlier registration', () => {
    const { form } = applyDefaults(emptyForm(), { account: { displayName: 'Dot Dale', region: 'British Columbia' }, fighter: { gender: 'female', teamId: 't9', region: null } }, ['t9']);
    expect(form).toMatchObject({ fullName: 'Dot Dale', gender: 'female', province: 'BC', teamId: 't9', organization: '' });
  });
  it('never overwrites what the person typed, and never fills a team that is not on the approved list', () => {
    const typed = { ...emptyForm(), fullName: 'Typed Name', gender: 'female' as const };
    const { form, filled } = applyDefaults(typed, { account: { displayName: 'Other', region: '' }, last: { fullName: 'Old', gender: 'male', organization: 'MCC', province: 'ON', teamId: 'gone', biProfile: '', sharesEquipment: null, emergencyName: '', emergencyRelationship: '', emergencyPhone: '' } }, ['t1']);
    expect(form.fullName).toBe('Typed Name'); expect(form.gender).toBe('female'); expect(form.teamId).toBe(''); expect(form.organization).toBe('MCC');
    expect(filled).not.toContain('name'); expect(filled).not.toContain('team');
  });
  it('never fills a declaration: medical fitness, the waiver, the fee, insurance, the medical note', () => {
    const { form } = applyDefaults(emptyForm(), { last: { fullName: 'A B', gender: 'male', organization: 'HACSA', province: 'AB', teamId: null, biProfile: '', sharesEquipment: true, emergencyName: 'Pat', emergencyRelationship: '', emergencyPhone: '1234567' } }, []);
    expect(form).toMatchObject({ medicallyFit: false, waiverAgree: false, waiverName: '', feeUnderstood: false, insurance: '', medicalNote: '' });
  });
});
