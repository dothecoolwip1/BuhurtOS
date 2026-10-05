import { PROVINCES, type RegForm } from './model';

/**
 * Registration should not make people retype what BuhurtOS already knows. Defaults come, most specific first, from the person's last registration,
 * then their fighter profile, then their account profile. They only ever fill EMPTY fields (what a person typed is never overwritten) and every
 * field stays editable. Declarations (medical fitness, the waiver, the fee, insurance) and the medical note are never filled in: each event needs a fresh yes.
 */
export interface DefaultSources {
  account?: { displayName: string; region: string } | null;
  fighter?: { gender: RegForm['gender']; teamId: string | null; region: string | null } | null;
  last?: {
    fullName: string; gender: RegForm['gender']; organization: RegForm['organization']; province: string; teamId: string | null; biProfile: string;
    sharesEquipment: boolean | null; emergencyName: string; emergencyRelationship: string; emergencyPhone: string;
  } | null;
}

/** "Alberta", "alberta" and "AB" all become "AB"; anything else (a state, free text) becomes "". */
export function provinceCode(text: string | null | undefined): string {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return '';
  return PROVINCES.find(([code, name]) => code.toLowerCase() === t || name.toLowerCase() === t)?.[0] ?? '';
}

const GENDERS = new Set(['male', 'female', 'other']);

export function applyDefaults(f: RegForm, s: DefaultSources, teamIds: readonly string[]): { form: RegForm; filled: string[] } {
  const next: RegForm = { ...f };
  const filled: string[] = [];
  const fill = <K extends keyof RegForm>(k: K, label: string, ...candidates: (RegForm[K] | null | undefined | '')[]) => {
    if (next[k] !== f[k] || (f[k] !== '' && f[k] !== undefined && f[k] !== null)) return;   // already has a value: never overwrite
    const v = candidates.find(c => c !== null && c !== undefined && c !== '');
    if (v === undefined || v === null || v === '') return;
    next[k] = v as RegForm[K]; filled.push(label);
  };
  const g = (x: string | undefined | null) => (x && GENDERS.has(x) ? (x as RegForm['gender']) : '');
  const team = (id: string | null | undefined) => (id && teamIds.includes(id) ? id : '');
  fill('fullName', 'name', s.last?.fullName, s.account?.displayName);
  fill('gender', 'gender', g(s.last?.gender), g(s.fighter?.gender));
  fill('organization', 'organization', s.last?.organization);
  fill('province', 'province', provinceCode(s.last?.province), provinceCode(s.fighter?.region), provinceCode(s.account?.region));
  fill('teamId', 'team', team(s.last?.teamId), team(s.fighter?.teamId));
  fill('biProfile', 'Buhurt International profile', s.last?.biProfile);
  if (f.sharesEquipment === '' && s.last?.sharesEquipment !== null && s.last?.sharesEquipment !== undefined) { next.sharesEquipment = s.last.sharesEquipment ? 'yes' : 'no'; filled.push('equipment sharing'); }
  fill('emergencyName', 'emergency contact', s.last?.emergencyName);
  fill('emergencyRelationship', 'emergency contact', s.last?.emergencyRelationship);
  fill('emergencyPhone', 'emergency contact', s.last?.emergencyPhone);
  return { form: next, filled: [...new Set(filled)] };
}
