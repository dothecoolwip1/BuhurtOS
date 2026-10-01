import { supabase } from '../lib/supabase';

/**
 * Account area: private personal details (entered once, autofill registration forms), profile photos and team images, "my teams".
 * Everything here is a database function or a Storage call that checks its own authority; the checks in this file are only for early,
 * friendly messages. Errors are thrown as-is so friendlyError can show the message.
 *
 * PRIVACY: the private profile (emergency contact, medical note, allergies, blood type) is readable only by its owner. Nothing in this file ever
 * sends it anywhere except the owner's own rpc calls. It is copied into a per-event snapshot by submit_registration (organizers and medics see only that).
 */

const num = (v: number | string | null | undefined): number => Number(v ?? 0);

// ================================================================ private personal profile
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];
export const MEDICAL_NOTE_MAX = 1000;
export const ALLERGIES_MAX = 500;
export const RELATIONSHIP_MAX = 60;
export const NAME_MAX = 120;

export interface PrivateProfile {
  fullName: string | null; phone: string | null; emergencyName: string | null; emergencyRelationship: string | null; emergencyPhone: string | null;
  medicallyFitDeclared: boolean; medicalNote: string | null; allergies: string | null; bloodType: BloodType | null; updatedAt: string;
}
type PrivateDb = {
  full_name: string | null; phone: string | null; emergency_name: string | null; emergency_relationship: string | null; emergency_phone: string | null;
  medically_fit_declared: boolean; medical_note: string | null; allergies: string | null; blood_type: string | null; updated_at: string;
};
const asBlood = (v: string | null): BloodType | null => ((BLOOD_TYPES as readonly string[]).includes(v ?? '') ? (v as BloodType) : null);
export const toPrivateProfile = (r: PrivateDb): PrivateProfile => ({
  fullName: r.full_name, phone: r.phone, emergencyName: r.emergency_name, emergencyRelationship: r.emergency_relationship, emergencyPhone: r.emergency_phone,
  medicallyFitDeclared: r.medically_fit_declared, medicalNote: r.medical_note, allergies: r.allergies, bloodType: asBlood(r.blood_type), updatedAt: r.updated_at
});

export interface PrivateForm {
  fullName: string; phone: string; emergencyName: string; emergencyRelationship: string; emergencyPhone: string;
  medicallyFitDeclared: boolean; medicalNote: string; allergies: string; bloodType: BloodType | '';
}
export const emptyPrivateForm = (): PrivateForm => ({ fullName: '', phone: '', emergencyName: '', emergencyRelationship: '', emergencyPhone: '', medicallyFitDeclared: false, medicalNote: '', allergies: '', bloodType: '' });
export const privateToForm = (p: PrivateProfile | null): PrivateForm => (p === null ? emptyPrivateForm() : {
  fullName: p.fullName ?? '', phone: p.phone ?? '', emergencyName: p.emergencyName ?? '', emergencyRelationship: p.emergencyRelationship ?? '', emergencyPhone: p.emergencyPhone ?? '',
  medicallyFitDeclared: p.medicallyFitDeclared, medicalNote: p.medicalNote ?? '', allergies: p.allergies ?? '', bloodType: p.bloodType ?? ''
});

/** Loose but sane: digits, spaces and + ( ) . / - only, at least 7 digits, at most 25 characters (same as the database). */
export function isValidPhone(raw: string): boolean {
  const s = raw.trim();
  return s.length >= 7 && s.length <= 25 && /^[0-9+()./ -]+$/.test(s) && (s.match(/\d/g)?.length ?? 0) >= 7;
}
/** Same limits as the database (which has the final say). Returns messages per field. */
export function validatePrivateForm(f: PrivateForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.fullName.trim() !== '' && (f.fullName.trim().length < 2 || f.fullName.trim().length > NAME_MAX)) e.fullName = `2 to ${NAME_MAX} characters.`;
  if (f.phone.trim() !== '' && !isValidPhone(f.phone)) e.phone = 'Enter a phone number with at least 7 digits.';
  if (f.emergencyName.trim() !== '' && (f.emergencyName.trim().length < 2 || f.emergencyName.trim().length > NAME_MAX)) e.emergencyName = `2 to ${NAME_MAX} characters.`;
  if (f.emergencyRelationship.trim().length > RELATIONSHIP_MAX) e.emergencyRelationship = `At most ${RELATIONSHIP_MAX} characters.`;
  if (f.emergencyPhone.trim() !== '' && !isValidPhone(f.emergencyPhone)) e.emergencyPhone = 'Enter a phone number with at least 7 digits.';
  if (f.medicalNote.trim().length > MEDICAL_NOTE_MAX) e.medicalNote = `At most ${MEDICAL_NOTE_MAX} characters.`;
  if (f.allergies.trim().length > ALLERGIES_MAX) e.allergies = `At most ${ALLERGIES_MAX} characters.`;
  if (f.bloodType !== '' && !(BLOOD_TYPES as readonly string[]).includes(f.bloodType)) e.bloodType = 'Choose a blood type or leave it empty.';
  return e;
}
/** The jsonb for save_my_private_profile. Empty fields become null (cleared); every key is sent, so the saved row mirrors the form. */
export function privatePayload(f: PrivateForm): Record<string, unknown> {
  const t = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    full_name: t(f.fullName), phone: t(f.phone), emergency_name: t(f.emergencyName), emergency_relationship: t(f.emergencyRelationship), emergency_phone: t(f.emergencyPhone),
    medically_fit_declared: f.medicallyFitDeclared, medical_note: t(f.medicalNote), allergies: t(f.allergies), blood_type: f.bloodType === '' ? null : f.bloodType
  };
}

/** Null when nothing has been saved yet. Only ever the caller's own row. */
export async function fetchMyPrivateProfile(): Promise<PrivateProfile | null> {
  const { data, error } = await supabase.rpc('get_my_private_profile');
  if (error) throw error;
  const rows = data as PrivateDb[];
  return rows.length ? toPrivateProfile(rows[0]) : null;
}
export async function saveMyPrivateProfile(f: PrivateForm): Promise<PrivateProfile> {
  const { data, error } = await supabase.rpc('save_my_private_profile', { p: privatePayload(f) });
  if (error) throw error;
  return toPrivateProfile((data as PrivateDb[])[0]);
}
/** Hard delete. Returns false when there was nothing saved. Registrations already submitted keep their own snapshot (deleted 30 days after the event). */
export async function deleteMyPrivateData(): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_my_private_data');
  if (error) throw error;
  return data as boolean;
}

// ================================================================ registration prefill
export interface RegistrationPrefill {
  hasSaved: boolean; fullName: string | null; phone: string | null; emergencyName: string | null; emergencyRelationship: string | null; emergencyPhone: string | null;
  medicallyFit: boolean; medicalNote: string | null; allergies: string | null; bloodType: BloodType | null; gender: 'male' | 'female' | 'other' | null;
  teamId: string | null; teamName: string | null;
}
type PrefillDb = {
  has_saved: boolean; full_name: string | null; phone: string | null; emergency_name: string | null; emergency_relationship: string | null; emergency_phone: string | null;
  medically_fit: boolean; medical_note: string | null; allergies: string | null; blood_type: string | null; gender: string | null; team_id: string | null; team_name: string | null;
};
export const toPrefill = (r: PrefillDb): RegistrationPrefill => ({
  hasSaved: r.has_saved, fullName: r.full_name, phone: r.phone, emergencyName: r.emergency_name, emergencyRelationship: r.emergency_relationship, emergencyPhone: r.emergency_phone,
  medicallyFit: r.medically_fit, medicalNote: r.medical_note, allergies: r.allergies, bloodType: asBlood(r.blood_type),
  gender: r.gender === 'male' || r.gender === 'female' || r.gender === 'other' ? r.gender : null, teamId: r.team_id, teamName: r.team_name
});
export async function fetchRegistrationPrefill(): Promise<RegistrationPrefill> {
  const { data, error } = await supabase.rpc('registration_prefill');
  if (error) throw error;
  return toPrefill((data as PrefillDb[])[0]);
}
/**
 * Fills EMPTY fields of a registration form from the prefill; never overwrites what the person typed. `form` uses the registration form's own names
 * (snake_case, as sent to submit_registration under `private`). The database also fills missing emergency fields on submit, so this is for showing them first.
 */
export interface RegistrationPrivateForm { full_name?: string; emergency_name?: string; emergency_relationship?: string; emergency_phone?: string; medical_note?: string; medically_fit?: boolean }
export function applyPrefill<T extends RegistrationPrivateForm>(form: T, p: RegistrationPrefill): T & RegistrationPrivateForm {
  const out: T & RegistrationPrivateForm = { ...form };
  const fill = (k: 'full_name' | 'emergency_name' | 'emergency_relationship' | 'emergency_phone', v: string | null) => { if ((out[k] ?? '').trim() === '' && v) (out as Record<string, unknown>)[k] = v; };
  fill('full_name', p.fullName); fill('emergency_name', p.emergencyName); fill('emergency_relationship', p.emergencyRelationship); fill('emergency_phone', p.emergencyPhone);
  if ((out.medical_note ?? '').trim() === '') {
    const note = [p.medicalNote, p.allergies ? `Allergies: ${p.allergies}` : null, p.bloodType ? `Blood type: ${p.bloodType}` : null].filter(Boolean).join('\n').slice(0, MEDICAL_NOTE_MAX);
    if (note !== '') out.medical_note = note;
  }
  if (out.medically_fit === undefined && p.medicallyFit) out.medically_fit = true;
  return out;
}

// ================================================================ photos (Storage bucket profile-photos)
export const PHOTO_BUCKET = 'profile-photos';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 8;
export const CAPTION_MAX = 140;
export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Client-side check before uploading (the bucket enforces the same type and size limits). Returns an error text or null. */
export function validatePhotoFile(file: { type: string; size: number }): string | null {
  if (!(file.type in PHOTO_TYPES)) return 'Use a JPEG, PNG or WebP image.';
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > MAX_PHOTO_BYTES) return 'The image is larger than 5 MB.';
  return null;
}
export const validateCaption = (c: string): string | null => (c.trim().length > CAPTION_MAX ? `At most ${CAPTION_MAX} characters.` : null);

/** The storage object name rule: a person writes only under `<their user id>/`, a captain only under `teams/<team id>/`. `unique` makes the name unguessable and never reused. */
export function personPhotoPath(userId: string, mime: string, unique: string): string {
  const ext = PHOTO_TYPES[mime];
  if (!ext) throw new Error('Use a JPEG, PNG or WebP image.');
  return `${userId}/${unique}.${ext}`;
}
export function teamImagePath(teamId: string, kind: 'logo' | 'banner', mime: string, unique: string): string {
  const ext = PHOTO_TYPES[mime];
  if (!ext) throw new Error('Use a JPEG, PNG or WebP image.');
  return `teams/${teamId}/${kind}-${unique}.${ext}`;
}
const uniqueId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

/** Public URL of a stored path (the bucket is public read). Pure: pass the project URL. */
export const publicPhotoUrl = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${PHOTO_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
/** Public URL through the client. Null path gives null. */
export const photoUrl = (path: string | null | undefined): string | null => (path ? supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl : null);

export interface FighterPhoto { id: string; fighterId: string; path: string; caption: string | null; isPrimary: boolean; sort: number; createdAt: string }
type PhotoDb = { id: string; fighter_id: string; storage_path: string; caption: string | null; is_primary: boolean; sort: number; created_at: string };
export const toFighterPhoto = (r: PhotoDb): FighterPhoto => ({ id: r.id, fighterId: r.fighter_id, path: r.storage_path, caption: r.caption, isPrimary: r.is_primary, sort: r.sort, createdAt: r.created_at });
/** Primary first, then in order. Empty for a private profile (except for its owner). */
export const sortPhotos = (rows: FighterPhoto[]): FighterPhoto[] => [...rows].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));

export async function fetchFighterPhotos(fighterId: string): Promise<FighterPhoto[]> {
  const { data, error } = await supabase.from('fighter_photos').select('id,fighter_id,storage_path,caption,is_primary,sort,created_at').eq('fighter_id', fighterId);
  if (error) throw error;
  return sortPhotos((data as unknown as PhotoDb[]).map(toFighterPhoto));
}

/**
 * Upload + register: puts the file at `<userId>/<unique>.<ext>` and calls add_my_photo. If registering fails (for example 8 photos already) the uploaded
 * object is removed again. Returns the new photo id.
 */
export async function uploadMyPhoto(userId: string, file: File, caption: string | null): Promise<string> {
  const bad = validatePhotoFile(file) ?? validateCaption(caption ?? '');
  if (bad) throw new Error(bad);
  const path = personPhotoPath(userId, file.type, uniqueId());
  const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (up.error) throw up.error;
  const { data, error } = await supabase.rpc('add_my_photo', { p_path: path, p_caption: caption && caption.trim() !== '' ? caption.trim() : null });
  if (error) { await supabase.storage.from(PHOTO_BUCKET).remove([path]); throw error; }
  return data as string;
}
export async function setMyPrimaryPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.rpc('set_my_primary_photo', { p_photo: photoId });
  if (error) throw error;
}
/** Removes the row, then deletes the stored object (the database returns the path; it never touches Storage itself). */
export async function removeMyPhoto(photoId: string): Promise<void> {
  const { data, error } = await supabase.rpc('remove_my_photo', { p_photo: photoId });
  if (error) throw error;
  await supabase.storage.from(PHOTO_BUCKET).remove([data as string]);
}
/** Captain or platform owner. Uploads under teams/<team id>/ then sets the logo or banner. Returns the stored path. */
export async function uploadTeamImage(teamId: string, kind: 'logo' | 'banner', file: File): Promise<string> {
  const bad = validatePhotoFile(file);
  if (bad) throw new Error(bad);
  const path = teamImagePath(teamId, kind, file.type, uniqueId());
  const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (up.error) throw up.error;
  const { error } = await supabase.rpc(kind === 'logo' ? 'set_team_logo' : 'set_team_banner', { p_team: teamId, p_path: path });
  if (error) { await supabase.storage.from(PHOTO_BUCKET).remove([path]); throw error; }
  return path;
}
export async function clearTeamImage(teamId: string, kind: 'logo' | 'banner'): Promise<void> {
  const { error } = await supabase.rpc(kind === 'logo' ? 'set_team_logo' : 'set_team_banner', { p_team: teamId, p_path: null });
  if (error) throw error;
}
/** Platform owner only. Removes the row and the stored object. */
export async function adminRemovePhoto(photoId: string): Promise<void> {
  const { data, error } = await supabase.rpc('admin_remove_photo', { p_photo: photoId });
  if (error) throw error;
  await supabase.storage.from(PHOTO_BUCKET).remove([data as string]);
}

// ================================================================ my teams
export type MyTeamRole = 'captain' | 'coach' | 'squire' | 'other' | 'fighter';
export interface MyTeamEvent { eventId: string; slug: string; name: string; startsOn: string; endsOn: string }
export interface MyTeam {
  teamId: string; name: string; slug: string; status: 'approved' | 'pending'; logoPath: string | null; role: MyTeamRole; isCaptain: boolean; since: string | null;
  organization: { id: string; slug: string; name: string } | null; rosterCount: number;
  /** Only for captains; null for everyone else. */
  pendingRequests: number | null; upcomingEvents: MyTeamEvent[];
}
type MyTeamDb = {
  team_id: string; team_name: string; team_slug: string; team_status: 'approved' | 'pending'; logo_path: string | null; role: MyTeamRole; is_captain: boolean; since: string | null;
  organization_id: string | null; organization_slug: string | null; organization_name: string | null; roster_count: number | string; pending_requests: number | string | null;
  upcoming_events: Array<{ event_id: string; slug: string; name: string; starts_on: string; ends_on: string }> | null;
};
export const toMyTeam = (r: MyTeamDb): MyTeam => ({
  teamId: r.team_id, name: r.team_name, slug: r.team_slug, status: r.team_status, logoPath: r.logo_path, role: r.role, isCaptain: r.is_captain, since: r.since,
  organization: r.organization_id && r.organization_slug && r.organization_name ? { id: r.organization_id, slug: r.organization_slug, name: r.organization_name } : null,
  rosterCount: num(r.roster_count), pendingRequests: r.pending_requests === null || r.pending_requests === undefined ? null : Number(r.pending_requests),
  upcomingEvents: (r.upcoming_events ?? []).map(e => ({ eventId: e.event_id, slug: e.slug, name: e.name, startsOn: e.starts_on, endsOn: e.ends_on }))
});
/** Every team the caller is on (captain first). Own data only. */
export async function fetchMyTeams(): Promise<MyTeam[]> {
  const { data, error } = await supabase.rpc('my_teams');
  if (error) throw error;
  return (data as MyTeamDb[]).map(toMyTeam);
}
