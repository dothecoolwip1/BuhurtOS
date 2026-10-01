import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import {
  applyPrefill, emptyPrivateForm, isValidPhone, personPhotoPath, privatePayload, privateToForm, publicPhotoUrl, sortPhotos, teamImagePath, toFighterPhoto, toMyTeam, toPrefill, toPrivateProfile,
  validateCaption, validatePhotoFile, validatePrivateForm, MAX_PHOTO_BYTES, type RegistrationPrefill
} from './account';

const privateDb = {
  full_name: 'Alice Legal', phone: '+1 403 555 0111', emergency_name: 'Pat Parent', emergency_relationship: 'parent', emergency_phone: '4035550100', medically_fit_declared: true,
  medical_note: 'Asthma', allergies: 'peanuts', blood_type: 'O+', updated_at: '2026-10-01T00:00:00Z'
};

describe('private profile', () => {
  it('maps the row and round trips through the form and the payload', () => {
    const p = toPrivateProfile(privateDb);
    expect(p).toMatchObject({ emergencyName: 'Pat Parent', medicallyFitDeclared: true, bloodType: 'O+' });
    expect(privatePayload(privateToForm(p))).toEqual({ full_name: 'Alice Legal', phone: '+1 403 555 0111', emergency_name: 'Pat Parent', emergency_relationship: 'parent', emergency_phone: '4035550100',
      medically_fit_declared: true, medical_note: 'Asthma', allergies: 'peanuts', blood_type: 'O+' });
  });
  it('an empty form clears every field and an unknown blood type maps to null', () => {
    expect(privatePayload(emptyPrivateForm())).toEqual({ full_name: null, phone: null, emergency_name: null, emergency_relationship: null, emergency_phone: null, medically_fit_declared: false,
      medical_note: null, allergies: null, blood_type: null });
    expect(toPrivateProfile({ ...privateDb, blood_type: 'Z+' }).bloodType).toBeNull();
    expect(privateToForm(null)).toEqual(emptyPrivateForm());
  });
  it('validates phones loosely but sanely', () => {
    expect(isValidPhone('+1 (403) 555-0100')).toBe(true);
    expect(isValidPhone('4035550100')).toBe(true);
    expect(isValidPhone('12-34')).toBe(false);
    expect(isValidPhone('call me maybe')).toBe(false);
    expect(isValidPhone('1'.repeat(26))).toBe(false);
  });
  it('validates the form with the database limits', () => {
    expect(validatePrivateForm(emptyPrivateForm())).toEqual({});
    const bad = { ...emptyPrivateForm(), phone: 'x', emergencyPhone: '12', emergencyName: 'A', medicalNote: 'm'.repeat(1001), allergies: 'a'.repeat(501), emergencyRelationship: 'r'.repeat(61), fullName: 'B' };
    expect(Object.keys(validatePrivateForm(bad)).sort()).toEqual(['allergies', 'emergencyName', 'emergencyPhone', 'emergencyRelationship', 'fullName', 'medicalNote', 'phone']);
    expect(validatePrivateForm({ ...emptyPrivateForm(), medicalNote: 'm'.repeat(1000), allergies: 'a'.repeat(500) })).toEqual({});
  });
});

describe('prefill', () => {
  const pre: RegistrationPrefill = toPrefill({ has_saved: true, full_name: 'Alice Legal', phone: null, emergency_name: 'Pat Parent', emergency_relationship: 'parent', emergency_phone: '4035550100',
    medically_fit: true, medical_note: 'Asthma', allergies: 'peanuts', blood_type: 'O+', gender: 'female', team_id: 't', team_name: 'Team' });
  it('maps the row', () => {
    expect(pre).toMatchObject({ hasSaved: true, gender: 'female', bloodType: 'O+', teamName: 'Team' });
    expect(toPrefill({ ...(pre as object), gender: 'robot' } as never).gender).toBeNull();
  });
  it('fills only empty fields and never overwrites what the person typed', () => {
    const out = applyPrefill({ emergency_name: 'Typed Name', emergency_phone: '' }, pre);
    expect(out).toMatchObject({ emergency_name: 'Typed Name', emergency_phone: '4035550100', emergency_relationship: 'parent', medically_fit: true });
    expect(out.medical_note).toBe('Asthma\nAllergies: peanuts\nBlood type: O+');
  });
  it('keeps an explicit note, an explicit medically_fit and does nothing for an unsaved profile', () => {
    expect(applyPrefill({ medical_note: 'mine', medically_fit: false }, pre)).toMatchObject({ medical_note: 'mine', medically_fit: false });
    const none = toPrefill({ has_saved: false, full_name: null, phone: null, emergency_name: null, emergency_relationship: null, emergency_phone: null, medically_fit: false, medical_note: null,
      allergies: null, blood_type: null, gender: null, team_id: null, team_name: null });
    expect(applyPrefill({ emergency_name: '' }, none)).toEqual({ emergency_name: '' });
  });
});

describe('photos', () => {
  it('accepts only jpeg, png and webp up to 5 MB', () => {
    expect(validatePhotoFile({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(validatePhotoFile({ type: 'image/png', size: MAX_PHOTO_BYTES })).toBeNull();
    expect(validatePhotoFile({ type: 'image/webp', size: 5 })).toBeNull();
    expect(validatePhotoFile({ type: 'image/gif', size: 1000 })).toMatch(/JPEG/);
    expect(validatePhotoFile({ type: 'application/pdf', size: 1000 })).toMatch(/JPEG/);
    expect(validatePhotoFile({ type: 'image/jpeg', size: MAX_PHOTO_BYTES + 1 })).toMatch(/5 MB/);
    expect(validatePhotoFile({ type: 'image/jpeg', size: 0 })).toMatch(/empty/);
  });
  it('limits captions to 140 characters', () => {
    expect(validateCaption('c'.repeat(140))).toBeNull();
    expect(validateCaption('c'.repeat(141))).not.toBeNull();
  });
  it('builds storage paths inside the allowed folders', () => {
    expect(personPhotoPath('u-1', 'image/jpeg', 'abc')).toBe('u-1/abc.jpg');
    expect(personPhotoPath('u-1', 'image/webp', 'abc')).toBe('u-1/abc.webp');
    expect(teamImagePath('t-1', 'logo', 'image/png', 'abc')).toBe('teams/t-1/logo-abc.png');
    expect(() => personPhotoPath('u-1', 'image/gif', 'abc')).toThrow();
    expect(() => teamImagePath('t-1', 'banner', 'text/plain', 'abc')).toThrow();
  });
  it('builds a public url and encodes path segments', () => {
    expect(publicPhotoUrl('https://x.supabase.co/', 'u-1/a b.jpg')).toBe('https://x.supabase.co/storage/v1/object/public/profile-photos/u-1/a%20b.jpg');
  });
  it('maps and sorts photos (primary first, then order)', () => {
    const mk = (id: string, sort: number, isPrimary: boolean) => toFighterPhoto({ id, fighter_id: 'f', storage_path: `f/${id}.jpg`, caption: null, is_primary: isPrimary, sort, created_at: '2026-01-01' });
    expect(sortPhotos([mk('b', 2, false), mk('c', 0, false), mk('a', 5, true)]).map(p => p.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('my teams', () => {
  it('maps a captain row with upcoming events and a plain member row', () => {
    const base = { team_id: 't', team_name: 'T', team_slug: 't-s', team_status: 'approved' as const, logo_path: null, role: 'captain' as const, is_captain: true, since: null,
      organization_id: 'o', organization_slug: 'org', organization_name: 'Org', roster_count: '4', pending_requests: 2,
      upcoming_events: [{ event_id: 'e', slug: 'ev', name: 'Event', starts_on: '2026-11-01', ends_on: '2026-11-02' }] };
    expect(toMyTeam(base)).toMatchObject({ rosterCount: 4, pendingRequests: 2, isCaptain: true, organization: { slug: 'org' }, upcomingEvents: [{ slug: 'ev', startsOn: '2026-11-01' }] });
    expect(toMyTeam({ ...base, role: 'fighter' as never, is_captain: false, pending_requests: null, organization_id: null, upcoming_events: null }))
      .toMatchObject({ pendingRequests: null, organization: null, upcomingEvents: [] });
  });
});
