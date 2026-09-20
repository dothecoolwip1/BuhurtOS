export interface StreamEmbed {
  provider: 'youtube' | 'twitch' | 'vimeo';
  embedUrl: string;
}

export function resolveStreamEmbed(rawUrl: string | undefined, parentHostname?: string): StreamEmbed | null {
  if (!rawUrl) return null;
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const videoId = url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : url.searchParams.get('v');
    if (videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}` };
  }
  if (host === 'youtu.be') {
    const videoId = url.pathname.split('/').filter(Boolean)[0];
    if (videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}` };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const videoId = url.pathname.split('/').filter(Boolean).reverse().find((segment: string) => /^\d+$/.test(segment));
    if (videoId) return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${videoId}` };
  }
  if (host === 'twitch.tv' || host === 'm.twitch.tv') {
    const parent = parentHostname || (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'videos' && /^\d+$/.test(parts[1] ?? '')) return { provider: 'twitch', embedUrl: `https://player.twitch.tv/?video=v${parts[1]}&parent=${encodeURIComponent(parent)}` };
    if (parts[0] && /^[A-Za-z0-9_]+$/.test(parts[0])) return { provider: 'twitch', embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(parts[0])}&parent=${encodeURIComponent(parent)}` };
  }
  return null;
}
