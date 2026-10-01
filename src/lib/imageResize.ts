/** Largest edge (pixels) of an uploaded photo. Bigger pictures are shrunk in the browser first so uploads stay quick on a phone. */
export const MAX_PHOTO_EDGE = 1600;

/** Pure: the size to draw at so the longer edge is at most `max`. Never enlarges; always at least 1 pixel. */
export function fitWithin(width: number, height: number, max: number = MAX_PHOTO_EDGE): { width: number; height: number; scaled: boolean } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1, scaled: false };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height), scaled: false };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scaled: true };
}

const QUALITY = 0.86;
const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>(res => c.toBlob(res, type, q));

/**
 * Shrinks a large image with a canvas. Returns the original file when it is already small enough or when the browser cannot do it
 * (the caller still validates type and size, and the storage bucket enforces them again). If the result is somehow bigger than the
 * original, the original is kept.
 */
export async function downscaleImage(file: File, max: number = MAX_PHOTO_EDGE): Promise<File> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const size = fitWithin(bmp.width, bmp.height, max);
    if (!size.scaled) { bmp.close?.(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close?.(); return file; }
    ctx.drawImage(bmp, 0, 0, size.width, size.height);
    bmp.close?.();
    const blob = await toBlob(canvas, file.type, QUALITY);
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: blob.type || file.type });
  } catch {
    return file;
  }
}
