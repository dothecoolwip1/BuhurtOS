/** Browser-side picture shrinking, so a phone photo is never uploaded at full size. */

/** Scales (w, h) down so the longer side is at most `max`, keeping the shape. Never scales up. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Shrinks any picture the phone can show to at most `max` px. PNG keeps transparency (emblems); JPEG is smaller (photos). Throws a plain sentence on failure. */
export async function shrinkImage(file: File, max: number, type: 'image/jpeg' | 'image/png'): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture file.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('That picture could not be read. Try a JPEG or PNG.'); }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize pictures.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, type, 0.85));
  if (!blob) throw new Error('That picture could not be converted.');
  return blob;
}
