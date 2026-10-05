import { supabase } from '../lib/supabase';
import type { NotificationKind } from './teamManager';

/** The four groups a person can switch on or off. Fights are the event-day alerts; the rest are quieter. */
export type NotificationCategory = 'fights' | 'team' | 'events' | 'system';
export type NotificationSettings = Record<NotificationCategory, boolean>;
export const CATEGORY_LABEL: Record<NotificationCategory, { title: string; sub: string }> = {
  fights: { title: 'Fights', sub: 'You are in the hole, on deck or up now. Changes to your fight.' },
  team: { title: 'Team', sub: 'Someone joins your team, join requests and answers.' },
  events: { title: 'Events', sub: 'Registration accepted or declined, an event you are in is cancelled.' },
  system: { title: 'BuhurtOS', sub: 'Account news such as a fighter profile you claimed.' }
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
export async function registerPushDevice(sub: { endpoint: string; p256dh: string; auth: string }, label: string): Promise<void> {
  const { error } = await supabase.rpc('register_push_device', { p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth, p_label: label });
  if (error) throw error;
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
