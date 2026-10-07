import { supabase } from '../lib/supabase';
import type { NotificationKind } from './teamManager';

/** The four groups a person can switch on or off. Fights are the event-day alerts; the rest are quieter. */
export type NotificationCategory = 'fights' | 'team' | 'events' | 'system';
export type NotificationSettings = Record<NotificationCategory, boolean>;
export const CATEGORY_LABEL: Record<NotificationCategory, { title: string; short: string; hint: string; sub: string }> = {
  fights: { title: 'Event-day fight alerts', short: 'Fight alerts', hint: 'Called to fight, 2 fights away, schedule changes', sub: 'You are 2 fights away, up next, or your fight is ready. Your fight changed Lyst or the schedule changed.' },
  team: { title: 'Team', short: 'Team', hint: 'Joins and requests', sub: 'Someone joins your team, join requests and answers.' },
  events: { title: 'Events', short: 'Events', hint: 'Announcements, registration, armour inspection', sub: 'Announcements from the organizers of an event you are in, registration decisions, armour inspection results, a cancelled event. For organizers and head marshals: a result that needs review.' },
  system: { title: 'BuhurtOS', short: 'BuhurtOS', hint: 'Account, profile claims, discipline', sub: 'Account news such as a fighter profile you claimed, and discipline decisions about you.' }
};
export const ALL_ON: NotificationSettings = { fights: true, team: true, events: true, system: true };

/** One line of the bell: ready-made words and the page a tap opens, both decided by the database (the same ones a push would carry). */
export interface FeedItem {
  id: string; kind: NotificationKind; category: NotificationCategory; title: string; body: string; route: string;
  payload: Record<string, unknown>; createdAt: string; readAt: string | null; unread: boolean;
}
type FeedDb = { id: string; kind: NotificationKind; category: NotificationCategory; title: string; body: string; route: string | null; payload: Record<string, unknown> | null; created_at: string; read_at: string | null };
export const toFeedItem = (r: FeedDb): FeedItem => ({
  id: r.id, kind: r.kind, category: r.category, title: r.title, body: r.body, route: r.route ?? '/account',
  payload: r.payload ?? {}, createdAt: r.created_at, readAt: r.read_at, unread: r.read_at === null
});

export async function fetchNotificationFeed(limit = 30): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc('my_notification_feed', { p_limit: limit });
  if (error) throw error;
  return (data as FeedDb[]).map(toFeedItem);
}

export async function fetchNotificationSettings(): Promise<NotificationSettings> {
  const { data, error } = await supabase.rpc('my_notification_settings');
  if (error) throw error;
  return { ...ALL_ON, ...(data as Partial<NotificationSettings>) };
}
export async function saveNotificationSettings(s: NotificationSettings): Promise<NotificationSettings> {
  const { data, error } = await supabase.rpc('set_notification_settings', { p_fights: s.fights, p_team: s.team, p_events: s.events, p_system: s.system });
  if (error) throw error;
  return { ...ALL_ON, ...(data as Partial<NotificationSettings>) };
}

export interface PushDevice { id: string; label: string; endpointDigest: string; createdAt: string; lastSuccessAt: string | null }
type DeviceDb = { id: string; label: string; endpoint_digest: string; created_at: string; last_success_at: string | null };
export async function fetchPushDevices(): Promise<PushDevice[]> {
  const { data, error } = await supabase.rpc('my_push_devices');
  if (error) throw error;
  return (data as DeviceDb[]).map(d => ({ id: d.id, label: d.label, endpointDigest: d.endpoint_digest, createdAt: d.created_at, lastSuccessAt: d.last_success_at }));
}
/** Returns the device's id on the server, so this browser can later remove exactly its own registration (permission revoked, address replaced). */
export async function registerPushDevice(sub: { endpoint: string; p256dh: string; auth: string }, label: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('register_push_device', { p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth, p_label: label });
  if (error) throw error;
  const id = (data as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : null;
}
export async function removePushDevice(by: { id: string } | { endpoint: string }): Promise<number> {
  const { data, error } = await supabase.rpc('remove_push_device', { p_id: 'id' in by ? by.id : null, p_endpoint: 'endpoint' in by ? by.endpoint : null });
  if (error) throw error;
  return data as number;
}
/** Null until the push dispatcher has created the server's key pair (nothing can be subscribed before that). */
export async function fetchPushPublicKey(): Promise<string | null> {
  const { data, error } = await supabase.rpc('push_public_key');
  if (error) throw error;
  return (data as string | null) ?? null;
}
export async function sendTestNotification(): Promise<{ devices: number }> {
  const { data, error } = await supabase.rpc('send_test_notification');
  if (error) throw error;
  return { devices: (data as { devices: number }).devices };
}

// ---------------------------------------------------------------- event announcements (organizers of the event; the database checks again)
export type AnnouncementAudience = 'everyone' | 'fighters';
export const ANNOUNCEMENT_MAX = 140;
export interface Announcement { id: string; message: string; audience: AnnouncementAudience; recipients: number; sentAt: string; sentByName: string }
type AnnouncementDb = { id: string; message: string; audience: AnnouncementAudience; recipients: number; sent_at: string; sent_by_name: string };
export async function sendEventAnnouncement(eventId: string, message: string, audience: AnnouncementAudience): Promise<{ recipients: number }> {
  const { data, error } = await supabase.rpc('send_event_announcement', { p_event: eventId, p_message: message, p_audience: audience });
  if (error) throw error;
  return { recipients: (data as { recipients: number }).recipients };
}
export async function fetchEventAnnouncements(eventId: string): Promise<Announcement[]> {
  const { data, error } = await supabase.rpc('list_event_announcements', { p_event: eventId });
  if (error) throw error;
  return (data as AnnouncementDb[]).map(a => ({ id: a.id, message: a.message, audience: a.audience, recipients: a.recipients, sentAt: a.sent_at, sentByName: a.sent_by_name }));
}
