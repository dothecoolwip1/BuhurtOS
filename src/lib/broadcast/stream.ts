/**
 * The event's livestream address, turned into something a page may embed. Allow-list only: YouTube, Twitch and Vimeo over https. Anything else
 * (another host, a look-alike host, http, a script address) yields null and the page shows no player. The database refuses the same addresses.
 * Pure: the page host (needed by Twitch) is passed in.
 */
export type StreamProvider = 'youtube' | 'twitch' | 'vimeo';
export interface StreamInfo {
  provider: StreamProvider;
  /** The public address to open in a new tab (always the address the organizer gave, after validation). */
  watchUrl: string;
  /** An address for an <iframe>, or null when this kind of link cannot be embedded (for example a YouTube @handle). */
  embedUrl: string | null;
}

export const STREAM_HOST = /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|twitch\.tv|vimeo\.com)(\/\S*)?$/;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;

export function parseStream(raw: string | null | undefined, parentHost: string): StreamInfo | null {
  const input = (raw ?? '').trim();
  if (!input || input.length > 300 || !STREAM_HOST.test(input)) return null;
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^(www|m)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    const id = parts[0] ?? '';
    return { provider: 'youtube', watchUrl: input, embedUrl: YT_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1` : null };
  }
  if (host === 'youtube.com') {
    const v = u.searchParams.get('v');
    if (parts[0] === 'watch' && v && YT_ID.test(v)) return { provider: 'youtube', watchUrl: input, embedUrl: `https://www.youtube-nocookie.com/embed/${v}?rel=0&modestbranding=1` };
    if ((parts[0] === 'live' || parts[0] === 'embed') && YT_ID.test(parts[1] ?? '')) return { provider: 'youtube', watchUrl: input, embedUrl: `https://www.youtube-nocookie.com/embed/${parts[1]}?rel=0&modestbranding=1` };
    if (parts[0] === 'channel' && YT_CHANNEL.test(parts[1] ?? '')) return { provider: 'youtube', watchUrl: input, embedUrl: `https://www.youtube-nocookie.com/embed/live_stream?channel=${parts[1]}&rel=0` };
    return { provider: 'youtube', watchUrl: input, embedUrl: null };
  }
  if (host === 'twitch.tv') {
    const parent = encodeURIComponent(parentHost);
    if (parts[0] === 'videos' && /^\d{1,12}$/.test(parts[1] ?? '')) return { provider: 'twitch', watchUrl: input, embedUrl: `https://player.twitch.tv/?video=${parts[1]}&parent=${parent}&autoplay=false` };
    if (/^[A-Za-z0-9_]{3,25}$/.test(parts[0] ?? '') && parts.length === 1) return { provider: 'twitch', watchUrl: input, embedUrl: `https://player.twitch.tv/?channel=${parts[0]}&parent=${parent}&autoplay=false` };
    return { provider: 'twitch', watchUrl: input, embedUrl: null };
  }
  if (host === 'vimeo.com') {
    if (/^\d{4,12}$/.test(parts[0] ?? '')) return { provider: 'vimeo', watchUrl: input, embedUrl: `https://player.vimeo.com/video/${parts[0]}` };
    if (parts[0] === 'event' && /^\d{4,12}$/.test(parts[1] ?? '')) return { provider: 'vimeo', watchUrl: input, embedUrl: `https://player.vimeo.com/event/${parts[1]}/embed` };
    return { provider: 'vimeo', watchUrl: input, embedUrl: null };
  }
  return null;
}

export const PROVIDER_LABEL: Record<StreamProvider, string> = { youtube: 'YouTube', twitch: 'Twitch', vimeo: 'Vimeo' };
