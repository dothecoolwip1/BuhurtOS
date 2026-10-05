import { supabase } from '../lib/supabase';
import type { DefaultSources } from '../registration/defaults';
import type { RegForm } from '../registration/model';

/**
 * What BuhurtOS already knows about the signed-in person, for the registration form: their account profile, their fighter profile and their most
 * recent registration (all readable only by them). Each part is optional: one failing never stops the form, it just fills less.
 */
export async function fetchRegistrationDefaults(userId: string): Promise<DefaultSources> {
  const [account, fighterId, last] = await Promise.allSettled([
    supabase.from('profiles').select('display_name,region').eq('id', userId).maybeSingle(),
    supabase.rpc('my_fighter_id'),
    supabase.from('registrations')
      .select('full_name,gender,organization,province,team_id,bi_profile,shares_equipment,registration_private(emergency_name,emergency_relationship,emergency_phone)')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  ]);
  const out: DefaultSources = {};
  if (account.status === 'fulfilled' && account.value.data) {
    const a = account.value.data as { display_name: string | null; region: string | null };
    out.account = { displayName: a.display_name ?? '', region: a.region ?? '' };
  }
  if (fighterId.status === 'fulfilled' && typeof fighterId.value.data === 'string') {
    const { data } = await supabase.from('fighters').select('gender,team_id,region').eq('id', fighterId.value.data).maybeSingle();
    const f = data as { gender: RegForm['gender'] | null; team_id: string | null; region: string | null } | null;
    if (f) out.fighter = { gender: f.gender ?? '', teamId: f.team_id, region: f.region };
  }
  if (last.status === 'fulfilled' && last.value.data) {
    type P = { emergency_name: string | null; emergency_relationship: string | null; emergency_phone: string | null };
    const r = last.value.data as unknown as { full_name: string; gender: RegForm['gender']; organization: RegForm['organization']; province: string | null; team_id: string | null; bi_profile: string | null; shares_equipment: boolean | null; registration_private: P | P[] | null };
    const p = Array.isArray(r.registration_private) ? r.registration_private[0] : r.registration_private;
    out.last = {
      fullName: r.full_name, gender: r.gender, organization: r.organization, province: r.province ?? '', teamId: r.team_id, biProfile: r.bi_profile ?? '',
      sharesEquipment: r.shares_equipment, emergencyName: p?.emergency_name ?? '', emergencyRelationship: p?.emergency_relationship ?? '', emergencyPhone: p?.emergency_phone ?? ''
    };
  }
  return out;
}
