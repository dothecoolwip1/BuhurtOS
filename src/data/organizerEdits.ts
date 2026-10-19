import { supabase } from '../lib/supabase';
import type { CompetitionMatch } from './matches';

export async function saveFieldLineup(eventId: string, field: string, matches: readonly CompetitionMatch[]): Promise<void> {
  const { data, error } = await supabase.rpc('save_field_lineup', {
    p_event: eventId, p_field: field, p_order: matches.map(m => m.id),
    p_versions: Object.fromEntries(matches.map(m => [m.id, {
      version: m.version, queue_state: m.queueState, queue_order: m.queueOrder ?? null,
      plan_order: m.planOrder ?? null, plan_hold: m.planHold === true
    }]))
  });
  if (error) throw error;
  checkReply(data);
}

export async function replaceMatchEntrant(match: CompetitionMatch, side: 'a' | 'b', entryId: string, reason: string): Promise<void> {
  const { data, error } = await supabase.rpc('replace_match_entrant', {
    p_match: match.id, p_side: side, p_entry: entryId, p_reason: reason.trim(), p_version: match.version
  });
  if (error) throw error;
  checkReply(data);
}

function checkReply(data: unknown): void {
  const status = (data as { status?: string } | null)?.status;
  if (status === 'stale') throw { code: 'P0001', message: 'The fight list changed on another device. Cancel and reopen the editor before saving again' };
  if (status !== 'ok' && status !== 'unchanged') throw new Error('The server did not confirm the change.');
}

export async function fetchEditableLineup(eventId: string, field: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('editable_field_lineup', { p_event: eventId, p_field: field });
  if (error) throw error;
  if (!Array.isArray(data) || data.some(id => typeof id !== 'string')) throw new Error('Could not load the editable fights.');
  return data as string[];
}
