import type { GeneratedBracket } from './bracket';
import type { Bracket, EventRecord, RosterEntry } from '../types';
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

export async function saveBracketPlan(event: EventRecord, plan: GeneratedBracket, options: { id: string; name: string; fightCardId?: string; divisionId?: string; category: string; format?: Bracket['format']; metadata?: Record<string, unknown> }): Promise<string> {
  if (!supabase) {
    const existing = JSON.parse(localStorage.getItem('buhurtos-demo-bracket-matches') ?? '[]');
    const ids = new Set(plan.matches.map(match => match.id));
    localStorage.setItem('buhurtos-demo-bracket-matches', JSON.stringify([...existing.filter((match: any) => !ids.has(match.id)), ...plan.matches]));
    return options.id;
  }
  const { data, error } = await supabase.rpc('save_bracket_plan', {
    p_bracket: { id: options.id, eventId: event.id, fightCardId: options.fightCardId ?? '', divisionId: options.divisionId ?? '', name: options.name, format: options.format ?? 'single_elimination', category: options.category, metadata: { generatedAt: new Date().toISOString(), antiFratricide: true, ...(options.metadata ?? {}) } },
    p_matches: plan.matches
  });
  if (error) throw error;
  return data as string;
}
