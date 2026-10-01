import { PHOTO_TYPES, applyPrefill, type PrivateForm, type RegistrationPrefill } from '../data/account';
import type { RegForm } from '../registration/model';

/** The plain-language promise shown wherever medical or emergency details are typed. Kept in one place so the wording cannot drift. */
export const PRIVATE_COPY = {
  headline: 'Only you can see this.',
  body: 'Only you can see this. When you register for an event it is copied to that event\'s organizers and medics, and the medical note is deleted 30 days after the event. You can delete it any time.',
  deleteLabel: 'Delete my saved medical and emergency information',
  deleteConfirm: 'This removes everything saved on this page. Registrations you already sent keep their own copy, which is deleted 30 days after the event.'
} as const;

export const PUBLIC_COPY = {
  public: 'Anyone can see your name, team, photos, bio and results. Your age and your height and weight stay hidden unless you switch them on below. Your medical and emergency details are never shown.',
  hidden: 'Only your name and team are shown. Your photos, bio and the rest of this card are hidden from everyone but you.'
} as const;

/** Up to two capital letters for an avatar fallback. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const a = parts[0].charAt(0), b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (a + b).toUpperCase();
}

const T = (s: string | null | undefined) => (s ?? '').trim();

/**
 * Fills EMPTY registration fields from the saved details; anything already typed wins. Allergies and blood type go into the medical note
 * (the registration form has no separate boxes). The team is only used when it is one of the choosable teams.
 */
export function prefillRegForm(f: RegForm, p: RegistrationPrefill, teamIds: string[]): { form: RegForm; filled: boolean } {
  if (!p.hasSaved && !p.gender && !p.teamId && !p.fullName) return { form: f, filled: false };
  const r = applyPrefill({
    full_name: f.fullName, emergency_name: f.emergencyName, emergency_relationship: f.emergencyRelationship, emergency_phone: f.emergencyPhone,
    medical_note: f.medicalNote, medically_fit: f.medicallyFit ? true : undefined
  }, p);
  const next: RegForm = {
    ...f, fullName: r.full_name ?? f.fullName, emergencyName: r.emergency_name ?? f.emergencyName, emergencyRelationship: r.emergency_relationship ?? f.emergencyRelationship,
    emergencyPhone: r.emergency_phone ?? f.emergencyPhone, medicalNote: r.medical_note ?? f.medicalNote, medicallyFit: r.medically_fit ?? f.medicallyFit,
    gender: f.gender === '' && p.gender ? p.gender : f.gender,
    teamId: f.teamId === '' && p.teamId && teamIds.includes(p.teamId) ? p.teamId : f.teamId
  };
  const changed = (['fullName', 'emergencyName', 'emergencyRelationship', 'emergencyPhone', 'medicalNote', 'medicallyFit', 'gender', 'teamId'] as const).some(k => next[k] !== f[k]);
  return { form: changed ? next : f, filled: changed };
}

/** What the registration form would save to the account. A medical note that was only filled in from the saved note + allergies + blood type is not saved twice. */
export function regToPrivateForm(f: RegForm, p: RegistrationPrefill): PrivateForm {
  const autoNote = applyPrefill({}, p).medical_note ?? '';
  const keepSaved = autoNote !== '' && T(f.medicalNote) === T(autoNote);
  return {
    fullName: T(f.fullName), phone: T(p.phone), emergencyName: T(f.emergencyName), emergencyRelationship: T(f.emergencyRelationship), emergencyPhone: T(f.emergencyPhone),
    medicallyFitDeclared: f.medicallyFit, medicalNote: keepSaved ? T(p.medicalNote) : T(f.medicalNote), allergies: T(p.allergies), bloodType: p.bloodType ?? ''
  };
}

/** True when saving the registration's details would change what is saved (so the one-tap offer is worth showing). */
export function regDiffersFromSaved(f: RegForm, p: RegistrationPrefill): boolean {
  const n = regToPrivateForm(f, p);
  const saved: PrivateForm = {
    fullName: T(p.fullName), phone: T(p.phone), emergencyName: T(p.emergencyName), emergencyRelationship: T(p.emergencyRelationship), emergencyPhone: T(p.emergencyPhone),
    medicallyFitDeclared: p.medicallyFit, medicalNote: T(p.medicalNote), allergies: T(p.allergies), bloodType: p.bloodType ?? ''
  };
  if (!p.hasSaved) return Boolean(n.fullName || n.emergencyName || n.emergencyPhone || n.medicalNote || n.medicallyFitDeclared);
  return (Object.keys(n) as (keyof PrivateForm)[]).some(k => n[k] !== saved[k]);
}

/** What others can see, in words, for the switches on the profile editor. */
export function visibilitySummary(s: { profilePublic: boolean; showAge: boolean; showPhysical: boolean }): string[] {
  if (!s.profilePublic) return ['Only your name and team'];
  return ['Name, team, photos, bio, results', s.showAge ? 'Your age' : 'Age hidden', s.showPhysical ? 'Height and weight' : 'Height and weight hidden'];
}

/** Checked when a photo is picked, before it is shrunk: only the type and an empty file stop it here. A big file is fine because it is made smaller first (the size limit is checked again afterwards). */
export function pickError(file: { type: string; size: number }): string | null {
  if (!(file.type in PHOTO_TYPES)) return 'Use a JPEG, PNG or WebP image.';
  if (file.size <= 0) return 'That file is empty.';
  return null;
}
