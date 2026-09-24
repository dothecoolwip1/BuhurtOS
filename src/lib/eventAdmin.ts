import type { EventRecord, FightCard } from '../types';
import { supabase } from './supabase';

export type RegistrationReviewStatus = 'pending' | 'approved' | 'waitlisted' | 'withdrawn' | 'rejected';
export type RegistrationPaymentStatus = 'not_required' | 'pending' | 'paid' | 'failed' | 'refunded';

export interface EventRegistrationAdmin {
  id: string;
  eventId: string;
  email: string;
  displayName: string;
  teamName?: string;
  category: string;
  phone?: string;
  emergencyContact?: string;
  waiverAcknowledged: boolean;
  waiverStoragePath?: string;
  status: RegistrationReviewStatus;
  paymentStatus: RegistrationPaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EventSettingsInput {
  status: EventRecord['status'];
  eventType: EventRecord['eventType'];
  standingsMode: EventRecord['standingsMode'];
  registrationOpen: boolean;
  livestreamUrl?: string;
}

const registrationsKey = (eventId: string) => 'buhurtos-demo-registrations-' + eventId;
const announcementsKey = (eventId: string) => 'buhurtos-demo-announcements-' + eventId;
const eventKey = (eventId: string) => 'buhurtos-demo-event-' + eventId;

function readDemo<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
}

export async function listEventRegistrations(eventId: string): Promise<EventRegistrationAdmin[]> {
  if (!supabase) return readDemo<EventRegistrationAdmin[]>(registrationsKey(eventId), []).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const { data, error } = await supabase
    .from('event_registrations')
    .select('id,event_id,email,display_name,team_name,category,phone,emergency_contact,waiver_acknowledged,waiver_storage_path,status,payment_status,created_at,updated_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    eventId: row.event_id,
    email: row.email,
    displayName: row.display_name,
    teamName: row.team_name ?? undefined,
    category: row.category,
    phone: row.phone ?? undefined,
    emergencyContact: row.emergency_contact ?? undefined,
    waiverAcknowledged: row.waiver_acknowledged,
    waiverStoragePath: row.waiver_storage_path ?? undefined,
    status: row.status,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function reviewRegistration(event: EventRecord, registrationId: string, status: Exclude<RegistrationReviewStatus, 'pending'>, expectedUpdatedAt?: string): Promise<void> {
  if (!supabase) {
    const items = readDemo<EventRegistrationAdmin[]>(registrationsKey(event.id), []);
    const next = items.map(item => item.id === registrationId ? { ...item, status, updatedAt: new Date().toISOString() } : item);
    localStorage.setItem(registrationsKey(event.id), JSON.stringify(next));
    if (status === 'approved') {
      const approved = next.find(item => item.id === registrationId);
      if (approved) {
        const guests = readDemo<any[]>('buhurtos-demo-ghosts', []);
        if (!guests.some(entry => entry.metadata?.registrationId === registrationId)) {
          guests.push({
            id: crypto.randomUUID(),
            organizationId: event.organizationId,
            eventId: event.id,
            entryType: 'guest_fighter',
            displayName: approved.displayName,
            checkedIn: false,
            armorCleared: false,
            medicalCleared: false,
            waiverConfirmed: approved.waiverAcknowledged,
            weighInCleared: false,
            attendanceStatus: 'approved',
            metadata: { registrationId, category: approved.category, teamName: approved.teamName ?? null }
          });
          localStorage.setItem('buhurtos-demo-ghosts', JSON.stringify(guests));
        }
      }
    }
    return;
  }
  if (!expectedUpdatedAt) throw new Error('Registration version is missing. Reload before reviewing it.');
  const { error } = await supabase.rpc('review_event_registration_guarded', {
    p_registration_id: registrationId,
    p_expected_updated_at: expectedUpdatedAt,
    p_status: status
  });
  if (error) throw error;
}

export async function updateEventSettings(event: EventRecord, input: EventSettingsInput): Promise<void> {
  if (!supabase) {
    localStorage.setItem(eventKey(event.id), JSON.stringify({ ...event, ...input }));
    return;
  }
  if (!event.updatedAt) throw new Error('Event version is missing. Reload before saving settings.');
  const { error } = await supabase.rpc('update_event_settings_guarded', {
    p_event_id: event.id,
    p_expected_updated_at: event.updatedAt,
    p_status: input.status,
    p_event_type: input.eventType,
    p_standings_mode: input.standingsMode,
    p_registration_open: input.registrationOpen,
    p_livestream_url: input.livestreamUrl?.trim() || null
  });
  if (error) throw error;
}

export async function createEventAnnouncement(eventId: string, input: { title: string; body: string; isPublic: boolean; scheduledFor?: string }): Promise<void> {
  if (!supabase) {
    const items = readDemo<any[]>(announcementsKey(eventId), []);
    items.unshift({
      id: crypto.randomUUID(),
      eventId,
      title: input.title.trim(),
      body: input.body.trim(),
      isPublic: input.isPublic,
      scheduledFor: input.scheduledFor || undefined,
      createdAt: new Date().toISOString()
    });
    localStorage.setItem(announcementsKey(eventId), JSON.stringify(items));
    return;
  }
  const { error } = await supabase.from('announcements').insert({
    event_id: eventId,
    title: input.title.trim(),
    body: input.body.trim(),
    is_public: input.isPublic,
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
    const next: FightCard = {
      id: crypto.randomUUID(),
      eventId,
      name: cleanName,
      listName: cleanName,
      status: 'live',
      sortOrder: existing.length
    };
    localStorage.setItem(fightCardsKey(eventId), JSON.stringify([...existing, next]));
    return;
  }
  const { error } = await supabase.rpc('create_fight_card_guarded', {
    p_event_id: eventId,
    p_name: cleanName
  });
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
    p_fight_card_id: card.id,
    p_expected_updated_at: card.updatedAt,
    p_name: nextName,
    p_status: nextStatus
  });
  if (error) throw error;
}
