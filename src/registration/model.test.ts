import { describe, expect, it } from 'vitest';
import { ALL_VOLUNTEER_ROLES, buildPayload, emptyForm, feeFor, formatMoney, validate, volunteerRolesFor, type CompetitionOption, type RegForm } from './model';

const fee = { feeCents: 4000, feeProvince: 'AB' };
const comps: CompetitionOption[] = [
  { id: 'c5', name: 'Melee 5v5 (men)', category: '5v5', league: 'buhurt', gender: 'men' },
  { id: 'cl', name: 'Longsword (men)', category: 'longsword', league: 'duels', gender: 'men' },
  { id: 'cp', name: 'Profight (men)', category: 'profight', league: 'outrance', gender: 'men' }
];
const good = (over: Partial<RegForm> = {}): RegForm => ({
  ...emptyForm('a@b.co'), fullName: 'Mara Kessling', gender: 'female', organization: 'HACSA', province: 'AB', sharesEquipment: 'no', days: ['sat'],
  competitionIds: ['cl'], insurance: 'hacsa_member', emergencyName: 'Pat Parent', emergencyPhone: '403 555 0100', medicallyFit: true,
  feeUnderstood: true, waiverAgree: true, waiverName: 'Mara Kessling', ...over
});

describe('feeFor', () => {
  it('charges Alberta fighters', () => expect(feeFor(fee, 'AB', false)).toBe(4000));
  it('does not charge people from outside Alberta', () => expect(feeFor(fee, 'BC', false)).toBe(0));
  it('does not charge volunteers', () => expect(feeFor(fee, 'AB', true)).toBe(0));
  it('charges everyone when no province is set', () => expect(feeFor({ feeCents: 1000, feeProvince: null }, 'BC', false)).toBe(1000));
  it('formats money', () => { expect(formatMoney(4000)).toBe('$40'); expect(formatMoney(4050)).toBe('$40.50'); });
});

describe('validate', () => {
  it('accepts a complete duel registration', () => expect(validate(good(), comps, fee)).toEqual({}));
  it('asks for a category unless volunteering', () => {
    expect(validate(good({ competitionIds: [] }), comps, fee).competitionIds).toBeTruthy();
    expect(validate(good({ competitionIds: [], isVolunteer: true, feeUnderstood: false }), comps, fee).competitionIds).toBeUndefined();
  });
  it('requires a team for melee and a weight for profight', () => {
    const e = validate(good({ competitionIds: ['c5', 'cp'] }), comps, fee);
    expect(e['team:c5']).toBeTruthy();
    expect(e['weight:cp']).toBeTruthy();
  });
  it('accepts a melee entry once a team is chosen', () => {
    expect(validate(good({ competitionIds: ['c5'], teamId: 't1' }), comps, fee)['team:c5']).toBeUndefined();
  });
  it('refuses the "not taking part" insurance answer', () => expect(validate(good({ insurance: 'declined' }), comps, fee).insurance).toContain('insurance'));
  it('needs the waiver, a signed name and the fit declaration', () => {
    const e = validate(good({ waiverAgree: false, waiverName: '', medicallyFit: false }), comps, fee);
    expect(e.waiverAgree && e.waiverName && e.medicallyFit).toBeTruthy();
  });
  it('asks to confirm the fee only when a fee is due', () => {
    expect(validate(good({ feeUnderstood: false }), comps, fee).feeUnderstood).toBeTruthy();
    expect(validate(good({ feeUnderstood: false, province: 'BC' }), comps, fee).feeUnderstood).toBeUndefined();
  });
});

describe('buildPayload', () => {
  it('builds what submit_registration expects', () => {
    const p = buildPayload(good({ medicalNote: ' Asthma ' }), 'w1');
    expect(p).toMatchObject({ full_name: 'Mara Kessling', waiver_version_id: 'w1', waiver_agree: true, insurance: 'hacsa_member', shares_equipment: false });
    expect(p.private).toMatchObject({ emergency_phone: '403 555 0100', medically_fit: true, medical_note: 'Asthma' });
    expect(p.competitions).toEqual([{ competition_id: 'cl', team_id: null, details: {} }]);
  });
  it('drops volunteer roles when not volunteering and keeps team and weight details', () => {
    const f = good({ competitionIds: ['cp'], details: { cp: { weight: '92 kg' } }, volunteerRoles: ['Squire'] });
    const p = buildPayload(f, 'w1');
    expect(p.volunteer_roles).toEqual([]);
    expect(p.competitions[0].details).toEqual({ weight: '92 kg' });
  });
});

describe('volunteer Other role', () => {
  const vol = (o: Partial<RegForm> = {}) => ({ ...emptyForm('a@b.ca'), ...o });
  it('offers all eight roles with Other last', () => {
    expect(ALL_VOLUNTEER_ROLES).toEqual(['Squire', 'Points counter', 'Marshal', 'Runner', 'Secretary', 'Scheduling', 'Ticket booth', 'Other']);
  });
  it('needs a description when Other is ticked, within the length limit', () => {
    const f = vol({ isVolunteer: true, volunteerRoles: ['Other'], volunteerOther: ' ' });
    const free = { feeCents: 0, feeProvince: null };
    expect(validate(f, [], free).volunteerOther).toBeTruthy();
    expect(validate({ ...f, volunteerOther: 'x'.repeat(201) }, [], free).volunteerOther).toBeTruthy();
    expect(validate({ ...f, volunteerOther: 'carry water' }, [], free).volunteerOther).toBeUndefined();
  });
  it('stores Other as "Other: <text>" and ignores the text when Other is not ticked', () => {
    expect(volunteerRolesFor(vol({ isVolunteer: true, volunteerRoles: ['Squire', 'Other'], volunteerOther: ' carry water ' }))).toEqual(['Squire', 'Other: carry water']);
    expect(volunteerRolesFor(vol({ isVolunteer: true, volunteerRoles: ['Squire'], volunteerOther: 'stale' }))).toEqual(['Squire']);
    expect(volunteerRolesFor(vol({ isVolunteer: false, volunteerRoles: ['Squire'] }))).toEqual([]);
  });
  it('never charges a volunteer', () => expect(feeFor({ feeCents: 4000, feeProvince: null }, 'AB', true)).toBe(0));
});

describe('waiver acceptance payload', () => {
  it('sends the waiver version id and the trimmed typed name, and refuses without agreement or name', () => {
    const f = { ...emptyForm('a@b.ca'), waiverAgree: true, waiverName: '  Pat Fighter ' };
    const p = buildPayload(f, 'w-123');
    expect(p.waiver_version_id).toBe('w-123');
    expect(p.waiver_signed_name).toBe('Pat Fighter');
    expect(p.waiver_agree).toBe(true);
    const e = validate({ ...f, waiverAgree: false, waiverName: ' ' }, [], { feeCents: 0, feeProvince: null });
    expect(e.waiverAgree).toBeTruthy(); expect(e.waiverName).toBeTruthy();
  });
});
