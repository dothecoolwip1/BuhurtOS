import type { EventRecord, FightCard } from '../types';
import { supabase } from './supabase';

export type RegistrationReviewStatus = 'pending' | 'approved' | 'waitlisted' | 'withdrawn' | 'rejected';
export type RegistrationPaymentStatus = 'not_required' | 'pending' | 'paid' | 'failed' | 'refunded';
export type RegistrationEligibilityStatus = 'eligible' | 'ineligible' | 'needs_review';
export type RegistrationKind = 'individual' | 'team';

export interface EventRegistrationAdmin {
  id: string;
  eventId: string;
  eventDivisionId?: string;
  fighterIdentityId?: string;
  email: string;
  displayName: string;
  teamName?: string;
  category: string;
  registrationKind: RegistrationKind;
  teamRoster: string[];
  teamSize?: number;
  phone?: string;
  emergencyContact?: string;
  waiverAcknowledged: boolean;
  waiverStoragePath?: string;
  eligibilityStatus: RegistrationEligibilityStatus;
  eligibilityReasons: string[];
  eligibilityOverrideReason?: string;
  organizerNotes?: string;
  status: RegistrationReviewStatus;
  paymentStatus: RegistrationPaymentStatus;
  reviewedAt?: string;
  withdrawnAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventSettingsInput {
  name: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: EventRecord['status'];
  eventType: EventRecord['eventType'];
  standingsMode: EventRecord['standingsMode'];
  registrationOpen: boolean;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  registrationCapacity?: number;
  waitlistEnabled: boolean;
  publicDescription?: string;
  livestreamUrl?: string;
}

const registrationsKey = (eventId: string) => 'buhurtos-demo-registrations-' + eventId;
const announcementsKey = (eventId: string) => 'buhurtos-demo-announcements-' + eventId;
const eventKey = (eventId: string) => 'buhurtos-demo-event-' + eventId;

function readDemo<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
}

function registrationRow(row: any): EventRegistrationAdmin {
  return {
    id: row.id, eventId: row.event_id ?? row.eventId, eventDivisionId: row.event_division_id ?? row.eventDivisionId ?? undefined,
    fighterIdentityId: row.fighter_identity_id ?? row.fighterIdentityId ?? undefined,
    email: row.email, displayName: row.display_name ?? row.displayName, teamName: row.team_name ?? row.teamName ?? undefined,
    category: row.category, registrationKind: row.registration_kind ?? row.registrationKind ?? 'individual',
    teamRoster: row.team_roster ?? row.teamRoster ?? [], teamSize: row.team_size ?? row.teamSize ?? undefined,
    phone: row.phone ?? undefined, emergencyContact: row.emergency_contact ?? row.emergencyContact ?? undefined,
    waiverAcknowledged: row.waiver_acknowledged ?? row.waiverAcknowledged ?? false,
    waiverStoragePath: row.waiver_storage_path ?? row.waiverStoragePath ?? undefined,
    eligibilityStatus: row.eligibility_status ?? row.eligibilityStatus ?? 'needs_review',
    eligibilityReasons: row.eligibility_reasons ?? row.eligibilityReasons ?? [],
    eligibilityOverrideReason: row.eligibility_override_reason ?? row.eligibilityOverrideReason ?? undefined,
    organizerNotes: row.organizer_notes ?? row.organizerNotes ?? undefined,
    status: row.status, paymentStatus: row.payment_status ?? row.paymentStatus ?? 'pending',
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? undefined, withdrawnAt: row.withdrawn_at ?? row.withdrawnAt ?? undefined,
    createdAt: row.created_at ?? row.createdAt, updatedAt: row.updated_at ?? row.updatedAt
  };
}

export async function listEventRegistrations(eventId: string): Promise<EventRegistrationAdmin[]> {
  if (!supabase) return readDemo<any[]>(registrationsKey(eventId), []).map(registrationRow).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const { data, error } = await supabase
    .from('event_registrations')
    .select('id,event_id,event_division_id,fighter_identity_id,email,display_name,team_name,category,registration_kind,team_roster,team_size,phone,emergency_contact,waiver_acknowledged,waiver_storage_path,eligibility_status,eligibility_reasons,eligibility_override_reason,organizer_notes,status,payment_status,reviewed_at,withdrawn_at,created_at,updated_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(registrationRow);
}

export async function reviewRegistration(
  event: EventRecord,
  registrationId: string,
  status: Exclude<RegistrationReviewStatus, 'pending'>,
  expectedUpdatedAt?: string,
  eligibilityOverrideReason?: string,
  organizerNotes?: string
): Promise<void> {
  if (!supabase) {
    const items = readDemo<any[]>(registrationsKey(event.id), []);
    const next = items.map(item => item.id === registrationId ? {
      ...item, status, eligibilityOverrideReason: eligibilityOverrideReason?.trim() || item.eligibilityOverrideReason,
      organizerNotes: organizerNotes?.trim() || item.organizerNotes, updatedAt: new Date().toISOString()
    } : item);
    localStorage.setItem(registrationsKey(event.id), JSON.stringify(next));
    if (status === 'approved') {
      const approved = next.find(item => item.id === registrationId);
      if (approved) {
        const guests = readDemo<any[]>('buhurtos-demo-ghosts', []);
        if (!guests.some(entry => entry.registrationId === registrationId || entry.metadata?.registrationId === registrationId)) {
          guests.push({
            id: crypto.randomUUID(), organizationId: event.organizationId, eventId: event.id,
            eventDivisionId: approved.eventDivisionId, registrationId,
            entryType: approved.registrationKind === 'team' ? 'team' : 'guest_fighter',
            displayName: approved.registrationKind === 'team' ? approved.teamName : approved.displayName,
            checkedIn: false, armorCleared: false, medicalCleared: false, waiverConfirmed: false,
            weighInCleared: false, competitionCleared: false, attendanceStatus: 'approved',
            metadata: { registrationId, category: approved.category, teamRoster: approved.teamRoster ?? [] }
          });
          localStorage.setItem('buhurtos-demo-ghosts', JSON.stringify(guests));
        }
      }
    }
    return;
  }
  if (!expectedUpdatedAt) throw new Error('Registration version is missing. Reload before reviewing it.');
  const { error } = await supabase.rpc('review_event_registration_v2_guarded', {
    p_registration_id: registrationId,
    p_expected_updated_at: expectedUpdatedAt,
    p_status: status,
    p_eligibility_override_reason: eligibilityOverrideReason?.trim() || null,
    p_organizer_notes: organizerNotes?.trim() || null
  });
  if (error) throw error;
}

export async function updateRegistrationRoster(
  registration: EventRegistrationAdmin,
  teamName: string,
  teamRoster: string[],
  organizerNotes?: string
): Promise<void> {
  if (!registration.updatedAt) throw new Error('Registration version is missing. Reload before editing it.');
  if (!supabase) return;
  const { error } = await supabase.rpc('update_registration_roster_guarded', {
    p_registration_id: registration.id,
    p_expected_updated_at: registration.updatedAt,
    p_team_name: teamName,
    p_team_roster: teamRoster,
    p_organizer_notes: organizerNotes?.trim() || null
  });
  if (error) throw error;
}

export async function updateEventSettings(event: EventRecord, input: EventSettingsInput): Promise<void> {
  if (!supabase) {
    localStorage.setItem(eventKey(event.id), JSON.stringify({ ...event, ...input }));
    return;
  }
  if (!event.updatedAt) throw new Error('Event version is missing. Reload before saving settings.');
  const { error } = await supabase.rpc('update_event_details_guarded', {
    p_event_id: event.id,
    p_expected_updated_at: event.updatedAt,
    p_name: input.name.trim(),
    p_venue: input.venue.trim(),
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_timezone: input.timezone.trim(),
    p_status: input.status,
    p_event_type: input.eventType,
    p_standings_mode: input.standingsMode,
    p_registration_open: input.registrationOpen,
    p_registration_opens_at: input.registrationOpensAt || null,
    p_registration_closes_at: input.registrationClosesAt || null,
    p_registration_capacity: input.registrationCapacity ?? null,
    p_waitlist_enabled: input.waitlistEnabled,
    p_public_description: input.publicDescription?.trim() || null,
    p_livestream_url: input.livestreamUrl?.trim() || null
  });
  if (error) throw error;
}

export async function createEventAnnouncement(eventId: string, input: { title: string; body: string; isPublic: boolean; scheduledFor?: string }): Promise<void> {
  if (!supabase) {
    const items = readDemo<any[]>(announcementsKey(eventId), []);
    items.unshift({ id: crypto.randomUUID(), eventId, title: input.title.trim(), body: input.body.trim(), isPublic: input.isPublic, scheduledFor: input.scheduledFor || undefined, createdAt: new Date().toISOString() });
    localStorage.setItem(announcementsKey(eventId), JSON.stringify(items));
    return;
  }
  const { error } = await supabase.from('announcements').insert({
    event_id: eventId, title: input.title.trim(), body: input.body.trim(), is_public: input.isPublic,
    scheduled_for: input.scheduledFor ? new Date(input.scheduledFor).toISOString() : null
  });
  if (error) throw error;
}

export async function deleteEventAnnouncement(eventId: string, announcementId: string): Promise<void> {
  if (!supabase) {
    const items = readDemo<any[]>(announcementsKey(eventId), []);
    localStorage.setItem(announcementsKey(eventId), JSON.stringify(items.filter(item => item.id !== announcementId)));
    return;
  }
  const { error } = await supabase.from('announcements').delete().eq('id', announcementId).eq('event_id', eventId);
  if (error) throw error;
}

const fightCardsKey = (eventId: string) => 'buhurtos-demo-fight-cards-' + eventId;

export async function createFightCard(eventId: string, name: string, existing: FightCard[]): Promise<void> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Field name is required.');
  if (!supabase) {
    const next: FightCard = { id: crypto.randomUUID(), eventId, name: cleanName, listName: cleanName, status: 'live', sortOrder: existing.length };
    localStorage.setItem(fightCardsKey(eventId), JSON.stringify([...existing, next]));
    return;
  }
  const { error } = await supabase.rpc('create_fight_card_guarded', { p_event_id: eventId, p_name: cleanName });
  if (error) throw error;
}

export async function updateFightCard(eventId: string, card: FightCard, input: { name?: string; status?: FightCard['status'] }, existing: FightCard[]): Promise<void> {
  const nextName = input.name?.trim() || card.name;
  const nextStatus = input.status ?? card.status;
  if (!supabase) {
    const next = existing.map(item => item.id === card.id ? { ...item, name: nextName, listName: nextName, status: nextStatus } : item);
    localStorage.setItem(fightCardsKey(eventId), JSON.stringify(next));
    return;
  }
  if (!card.updatedAt) throw new Error('Tournament field version is missing. Reload before saving it.');
  const { error } = await supabase.rpc('update_fight_card_guarded', {
    p_fight_card_id: card.id, p_expected_updated_at: card.updatedAt, p_name: nextName, p_status: nextStatus
  });
  if (error) throw error;
}
