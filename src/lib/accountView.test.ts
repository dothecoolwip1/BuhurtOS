import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
import type { RegistrationPrefill } from '../data/account';
import { emptyForm } from '../registration/model';
import { initials, pickError, prefillRegForm, PRIVATE_COPY, regDiffersFromSaved, regToPrivateForm, visibilitySummary } from './accountView';

const saved: RegistrationPrefill = {
  hasSaved: true, fullName: 'Alice Legal', phone: '403 555 0111', emergencyName: 'Pat Parent', emergencyRelationship: 'parent', emergencyPhone: '4035550100', medicallyFit: true,
  medicalNote: 'Asthma', allergies: 'peanuts', bloodType: 'O+', gender: 'female', teamId: 't1', teamName: 'Wolves'
};
const none: RegistrationPrefill = { hasSaved: false, fullName: null, phone: null, emergencyName: null, emergencyRelationship: null, emergencyPhone: null, medicallyFit: false, medicalNote: null, allergies: null, bloodType: null, gender: null, teamId: null, teamName: null };

describe('privacy copy', () => {
  it('says the three promises plainly', () => {
    expect(PRIVATE_COPY.body).toContain('Only you can see this.');
    expect(PRIVATE_COPY.body).toContain('30 days after the event');
    expect(PRIVATE_COPY.body).toContain('delete it any time');
  });
});

describe('prefillRegForm', () => {
  it('fills empty fields, folds allergies and blood type into the note, and picks the team and gender', () => {
    const { form, filled } = prefillRegForm(emptyForm('a@b.ca'), saved, ['t1', 't2']);
    expect(filled).toBe(true);
    expect(form).toMatchObject({ fullName: 'Alice Legal', emergencyName: 'Pat Parent', emergencyRelationship: 'parent', emergencyPhone: '4035550100', medicallyFit: true, gender: 'female', teamId: 't1', email: 'a@b.ca' });
    expect(form.medicalNote).toBe('Asthma\nAllergies: peanuts\nBlood type: O+');
  });
  it('typed values win', () => {
    const typed = { ...emptyForm(), fullName: 'Ali', emergencyName: 'Sam', gender: 'other' as const, medicalNote: 'my note', teamId: 't2' };
    const { form } = prefillRegForm(typed, saved, ['t1', 't2']);
    expect(form).toMatchObject({ fullName: 'Ali', emergencyName: 'Sam', gender: 'other', medicalNote: 'my note', teamId: 't2', emergencyPhone: '4035550100' });
  });
  it('ignores a team that is not choosable and does nothing with nothing saved', () => {
    expect(prefillRegForm(emptyForm(), saved, ['zzz']).form.teamId).toBe('');
    const f = emptyForm();
    expect(prefillRegForm(f, none, [])).toEqual({ form: f, filled: false });
  });
});

describe('saving back to the account', () => {
  const filledForm = () => prefillRegForm(emptyForm(), saved, ['t1']).form;
  it('does not offer to save when nothing changed, and does not duplicate allergies into the note', () => {
    expect(regDiffersFromSaved(filledForm(), saved)).toBe(false);
    expect(regToPrivateForm(filledForm(), saved)).toMatchObject({ medicalNote: 'Asthma', allergies: 'peanuts', bloodType: 'O+', phone: '403 555 0111' });
  });
  it('offers when something was edited, and the edit is what gets saved', () => {
    const f = { ...filledForm(), emergencyPhone: '5875550000' };
    expect(regDiffersFromSaved(f, saved)).toBe(true);
    expect(regToPrivateForm(f, saved).emergencyPhone).toBe('5875550000');
  });
  it('offers when nothing was saved but details were typed', () => {
    expect(regDiffersFromSaved(emptyForm(), none)).toBe(false);
    expect(regDiffersFromSaved({ ...emptyForm(), emergencyName: 'Pat' }, none)).toBe(true);
  });
});

describe('small helpers', () => {
  it('initials', () => {
    expect(initials('alice  legal')).toBe('AL');
    expect(initials('Cher')).toBe('C');
    expect(initials('')).toBe('?');
  });
  it('pickError only stops a wrong type or empty file (big files are shrunk first)', () => {
    expect(pickError({ type: 'image/gif', size: 10 })).toMatch(/JPEG/);
    expect(pickError({ type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(pickError({ type: 'image/jpeg', size: 20 * 1024 * 1024 })).toBeNull();
  });
  it('visibility summary follows the switches', () => {
    expect(visibilitySummary({ profilePublic: false, showAge: true, showPhysical: true })).toEqual(['Only your name and team']);
    expect(visibilitySummary({ profilePublic: true, showAge: true, showPhysical: false })).toContain('Your age');
  });
});
