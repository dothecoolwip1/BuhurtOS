/**
 * Broadcast data. READ-ONLY for everyone except an organizer of the event (writes are database functions that check the role again).
 * The overlay reads public tables only: nothing here selects an account, contact or health column.
 */
import { supabase } from '../lib/supabase';
import { shrinkImage } from '../lib/image';
import { avatarUrl } from './fighters';
import { teamEmblemUrl } from './teamDirectory';
import type { Sponsor } from '../lib/broadcast/sponsors';
import type { CornerScheme, SideSource } from '../lib/broadcast/sides';
import type { CrestDivision } from './types';

export interface BroadcastSettings {
  streamUrl: string | null; streamTitle: string | null; corners: CornerScheme; showRecords: boolean; showPhotos: boolean; showSponsors: boolean; sponsorSeconds: number;
}
export const DEFAULT_BROADCAST: BroadcastSettings = { streamUrl: null, streamTitle: null, corners: 'red_blue', showRecords: true, showPhotos: true, showSponsors: true, sponsorSeconds: 8 };

type SettingsRow = { stream_url: string | null; stream_title: string | null; corners: CornerScheme; show_records: boolean; show_photos: boolean; show_sponsors: boolean; sponsor_seconds: number };
type SponsorRow = { id: string; name: string; logo_path: string | null; link_url: string | null; tier: 'title' | 'partner'; sort_order: number; on_broadcast: boolean };

export const sponsorLogoUrl = (path: string | null | undefined): string | null => (path ? supabase.storage.from('sponsor-logos').getPublicUrl(path).data.publicUrl : null);
const toSettings = (r: SettingsRow): BroadcastSettings => ({
  streamUrl: r.stream_url, streamTitle: r.stream_title, corners: r.corners, showRecords: r.show_records, showPhotos: r.show_photos, showSponsors: r.show_sponsors, sponsorSeconds: r.sponsor_seconds
});
const toSponsor = (r: SponsorRow): Sponsor => ({ id: r.id, name: r.name, logoUrl: sponsorLogoUrl(r.logo_path), linkUrl: r.link_url, tier: r.tier, sortOrder: r.sort_order, onBroadcast: r.on_broadcast });

/** The event's broadcast options and sponsors (public for a published event). */
export async function fetchBroadcastConfig(eventId: string): Promise<{ settings: BroadcastSettings; sponsors: Sponsor[]; logoPaths: Record<string, string | null> }> {
  const [s, sp] = await Promise.all([
    supabase.from('event_broadcast').select('stream_url,stream_title,corners,show_records,show_photos,show_sponsors,sponsor_seconds').eq('event_id', eventId).maybeSingle(),
    supabase.from('event_sponsors').select('id,name,logo_path,link_url,tier,sort_order,on_broadcast').eq('event_id', eventId).order('sort_order').order('name')
  ]);
  if (s.error) throw s.error;
  if (sp.error) throw sp.error;
  const rows = (sp.data ?? []) as SponsorRow[];
  return { settings: s.data ? toSettings(s.data as SettingsRow) : DEFAULT_BROADCAST, sponsors: rows.map(toSponsor), logoPaths: Object.fromEntries(rows.map(r => [r.id, r.logo_path])) };
}

// ---------------------------------------------------------------- the two sides of a fight
type TeamRow = { id: string; name: string; colors: string[]; crest_division: CrestDivision; initial: string; emblem_path: string | null; city: string | null; region: string | null; country: string | null };
type EntryRow = { id: string; team_id: string | null; fighter_id: string | null; teams: TeamRow | TeamRow[] | null; fighters: { display_name: string; avatar_path: string | null; teams: TeamRow | TeamRow[] | null } | { display_name: string; avatar_path: string | null; teams: TeamRow | TeamRow[] | null }[] | null };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const TEAM = 'id,name,colors,crest_division,initial,emblem_path,city,region,country';
const toTeam = (t: TeamRow | null): SideSource['team'] => (t ? {
  id: t.id, name: t.name, colors: [t.colors?.[0] ?? '#2C4A8C', t.colors?.[1] ?? '#E9ECEF'], division: t.crest_division, initial: t.initial, emblemUrl: teamEmblemUrl(t.emblem_path), city: t.city, region: t.region, country: t.country
} : null);

type CareerRow = { context: string; scope: string; kind: string | null; category: string | null; wins: number; losses: number; draws: number };
const careerRecord = (rows: CareerRow[] | null): SideSource['record'] => {
  // the all-time total row: official when the fighter has one, else the labelled test record (a fictional event's history)
  const total = (ctx: string) => (rows ?? []).find(r => r.context === ctx && r.scope === 'career' && r.kind === null && r.category === null);
  const o = total('official'), t = o ? undefined : total('test');
  const r = o ?? t;
  return r ? { wins: r.wins, losses: r.losses, draws: r.draws, test: !o } : null;
};

/** Both sides of the fights on screen, from public records only. One request for the entries, one record lookup per side. */
export async function fetchSides(entryIds: readonly string[], withRecords: boolean): Promise<Record<string, SideSource>> {
  const ids = [...new Set(entryIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from('entries').select(`id,team_id,fighter_id,teams(${TEAM}),fighters(display_name,avatar_path,teams(${TEAM}))`).in('id', ids);
  if (error) throw error;
  const out: Record<string, SideSource> = {};
  await Promise.all(((data ?? []) as unknown as EntryRow[]).map(async r => {
    const f = one(r.fighters), entryTeam = one(r.teams);
    const kind = r.team_id ? 'team' : 'fighter';
    let record: SideSource['record'] = null;
    if (withRecords) {
      try {
        const rpc = r.team_id ? await supabase.rpc('team_career', { p_team: r.team_id }) : r.fighter_id ? await supabase.rpc('fighter_career', { p_fighter: r.fighter_id }) : null;
        if (rpc && !rpc.error) record = careerRecord(rpc.data as CareerRow[]);
      } catch { /* a record is a nicety: the graphic goes on without it */ }
    }
    out[r.id] = {
      entryId: r.id, kind, name: (kind === 'team' ? entryTeam?.name : f?.display_name) ?? '', team: toTeam(kind === 'team' ? entryTeam : one(f?.teams)), avatarUrl: kind === 'fighter' ? avatarUrl(f?.avatar_path) : null, record
    };
  }));
  return out;
}

// ---------------------------------------------------------------- organizer writes (the database checks the role again on every call)
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
export const saveBroadcastSettings = (eventId: string, patch: Partial<{ stream_url: string; stream_title: string; corners: CornerScheme; show_records: boolean; show_photos: boolean; show_sponsors: boolean; sponsor_seconds: number }>) =>
  rpc<unknown>('set_broadcast_settings', { p_event: eventId, p_settings: patch });

export interface SponsorInput { id?: string | null; name: string; logoPath: string | null; link: string | null; tier: 'title' | 'partner'; sort: number; onBroadcast: boolean }
export const saveSponsor = (eventId: string, s: SponsorInput) =>
  rpc<unknown>('save_event_sponsor', { p_event: eventId, p_id: s.id ?? null, p_name: s.name, p_logo_path: s.logoPath, p_link: s.link, p_tier: s.tier, p_sort: s.sort, p_on_broadcast: s.onBroadcast });
export async function removeSponsor(id: string, logoPath: string | null): Promise<void> {
  await rpc<unknown>('remove_event_sponsor', { p_id: id });
  if (logoPath) await supabase.storage.from('sponsor-logos').remove([logoPath]);
}
export const SPONSOR_LOGO_MAX_PX = 640;
/** Shrinks the picture in the browser (keeps transparency) and stores it in the event's own folder. Returns the stored path. */
export async function uploadSponsorLogo(eventId: string, file: File): Promise<string> {
  const blob = await shrinkImage(file, SPONSOR_LOGO_MAX_PX, 'image/png');
  const path = `${eventId}/${Date.now()}.png`;
  const up = await supabase.storage.from('sponsor-logos').upload(path, blob, { contentType: 'image/png', cacheControl: '31536000' });
  if (up.error) throw up.error;
  return path;
}
