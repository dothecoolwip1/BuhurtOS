import type { GeneratedBracket } from './bracket';
import type { EventRecord, RosterEntry } from '../types';
import { supabase } from './supabase';

export async function addGhostFighter(event: EventRecord, displayName: string, teamId?: string): Promise<RosterEntry> {
  const row: RosterEntry = {
    id: crypto.randomUUID(), organizationId: event.organizationId, eventId: event.id, teamId, entryType: 'ghost_fighter', displayName,
    checkedIn: false, armorCleared: false, medicalCleared: false, waiverConfirmed: false, weighInCleared: false, attendanceStatus: 'registered'
  };
  if (!supabase) {
    const key = 'buhurtos-demo-ghosts';
    const current = JSON.parse(localStorage.getItem(key) ?? '[]');
    localStorage.setItem(key, JSON.stringify([...current, row]));
    return row;
  }
  const { data, error } = await supabase.from('event_roster_entries').insert({ organization_id: event.organizationId, event_id: event.id, team_id: teamId ?? null, entry_type: 'ghost_fighter', display_name: displayName, ghost_original_name: displayName }).select('*').single();
  if (error) throw error;
  return { ...row, id: data.id };
}

export async function saveBracketPlan(event: EventRecord, plan: GeneratedBracket, options: { id: string; name: string; fightCardId?: string; category: string }): Promise<string> {
  if (!supabase) {
    localStorage.setItem('buhurtos-demo-bracket-matches', JSON.stringify(plan.matches));
    return options.id;
  }
  const { data, error } = await supabase.rpc('save_bracket_plan', {
    p_bracket: { id: options.id, eventId: event.id, fightCardId: options.fightCardId ?? '', name: options.name, format: 'single_elimination', category: options.category, metadata: { generatedAt: new Date().toISOString(), antiFratricide: true } },
    p_matches: plan.matches
  });
  if (error) throw error;
  return data as string;
}
