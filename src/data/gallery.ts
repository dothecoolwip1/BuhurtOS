import { shrinkImage } from '../lib/image';
import { supabase } from '../lib/supabase';

/**
 * A fighter's public gallery: up to GALLERY_MAX photos in the public bucket 'fighter-gallery', one folder per fighter, rows in
 * fighter_gallery. Only the fighter who owns the record can write (database functions and storage policies); everyone can look.
 */
export const GALLERY_MAX = 10;
export const GALLERY_MAX_PX = 1800;
export const BUCKET = 'fighter-gallery';

export interface GalleryPhoto { id: string; fighterId: string; path: string; sortOrder: number; createdAt: string }
type Row = { id: string; fighter_id: string; storage_path: string; sort_order: number; created_at: string };
export const toGalleryPhoto = (r: Row): GalleryPhoto => ({ id: r.id, fighterId: r.fighter_id, path: r.storage_path, sortOrder: r.sort_order, createdAt: r.created_at });

export const galleryUrl = (path: string): string => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

/** Public. In the fighter's chosen order. */
export async function fetchGallery(fighterId: string): Promise<GalleryPhoto[]> {
  const { data, error } = await supabase.from('fighter_gallery').select('id,fighter_id,storage_path,sort_order,created_at').eq('fighter_id', fighterId).order('sort_order').order('created_at');
  if (error) throw error;
  return (data as Row[]).map(toGalleryPhoto);
}

/** WebP where the browser can make one (smaller), else JPEG. Drawing through a canvas drops EXIF data (location, device) on the phone. */
export async function encodeGalleryPhoto(file: File, max = GALLERY_MAX_PX): Promise<{ blob: Blob; ext: 'webp' | 'jpg'; type: 'image/webp' | 'image/jpeg' }> {
  const webp = await shrinkImage(file, max, 'image/webp').catch(() => null);
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp', type: 'image/webp' };
  const jpg = await shrinkImage(file, max, 'image/jpeg');
  return { blob: jpg, ext: 'jpg', type: 'image/jpeg' };
}

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-000000000000`.slice(0, 36));

/** Shrinks, uploads into the caller's own folder and records the photo. The database refuses an eleventh photo; the file is then removed. */
export async function addMyGalleryPhoto(fighterId: string, file: File, current: number): Promise<GalleryPhoto> {
  if (current >= GALLERY_MAX) throw new Error(`A gallery holds at most ${GALLERY_MAX} photos. Remove one first.`);
  const enc = await encodeGalleryPhoto(file);
  const path = `${fighterId}/${uuid()}.${enc.ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, enc.blob, { contentType: enc.type, cacheControl: '31536000' });
  if (up.error) throw up.error;
  const { data, error } = await supabase.rpc('add_my_gallery_photo', { p_path: path });
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw error; }
  return { id: data as string, fighterId, path, sortOrder: current, createdAt: new Date().toISOString() };
}

export async function removeMyGalleryPhoto(photoId: string): Promise<void> {
  const { data, error } = await supabase.rpc('remove_my_gallery_photo', { p_id: photoId });
  if (error) throw error;
  const rm = await supabase.storage.from(BUCKET).remove([data as string]);
  if (rm.error) console.warn('[BuhurtOS] gallery file not removed', rm.error);
}

export async function reorderMyGallery(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_my_gallery', { p_ids: ids });
  if (error) throw error;
}

/** Moves one item up or down; returns the same list when it cannot move. */
export function moveInList<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const j = index + delta;
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[index], out[j]] = [out[j], out[index]];
  return out;
}
