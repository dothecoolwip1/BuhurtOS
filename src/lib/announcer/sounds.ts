/**
 * The Announcer's hype sounds (beta realm): short pre-recorded ring-announcer calls the person on the microphone can fire from the tablet.
 *
 * The clips are fixed files under public/announcer (made once with ElevenLabs, "World Wrestling Announcer" voice), so the day never depends on a
 * speech service or a key: they load with the app and the service worker keeps them once played. Nothing here writes anything.
 */
export interface AnnouncerSound {
  /** Stable id (also the analytics property). */
  id: string;
  /** What the button says. */
  label: string;
  /** File name under public/announcer. Version the name when a clip is replaced, so cached copies are not served instead. */
  file: string;
}

export const ANNOUNCER_SOUNDS: readonly AnnouncerSound[] = [
  { id: 'ladies_gentlemen', label: 'Ladies and gentlemen', file: 'ladies-and-gentlemen.mp3' },
  { id: 'now_fighting', label: 'Now fighting', file: 'now-fighting.mp3' },
  { id: 'up_next', label: 'Up next', file: 'up-next.mp3' },
  { id: 'in_the_hole', label: 'In the hole', file: 'in-the-hole.mp3' },
  { id: 'red_corner', label: 'Red corner', file: 'red-corner.mp3' },
  { id: 'blue_corner', label: 'Blue corner', file: 'blue-corner.mp3' },
  { id: 'fight', label: 'Fight!', file: 'fight.mp3' },
  { id: 'winner', label: 'And the winner is', file: 'and-the-winner-is.mp3' },
  { id: 'get_ready', label: "Let's get ready to buhurt", file: 'lets-get-ready-to-buhurt.mp3' }
];

/** Where a clip is served from, for this build's base path (GitHub Pages serves the app under /BuhurtOS/). */
export function soundUrl(base: string, file: string): string {
  return `${base.replace(/\/$/, '')}/announcer/${file}`;
}

/** Minimal audio surface, so the player can be driven without a browser. */
export interface SoundElement {
  src: string;
  currentTime: number;
  volume: number;
  play(): Promise<void> | void;
  pause(): void;
  preload: string;
}

/**
 * One player for the panel: a tap always plays that call from its start (a second tap restarts it), and a new call cuts the one still playing, because
 * the microphone cannot say two things at once. Always at full volume: the venue speakers set the room.
 */
export function createSoundPlayer(make: (src: string) => SoundElement) {
  const cache = new Map<string, SoundElement>();
  let current: SoundElement | null = null;
  const get = (src: string): SoundElement => {
    let el = cache.get(src);
    if (!el) { el = make(src); el.preload = 'auto'; el.volume = 1; cache.set(src, el); }
    return el;
  };
  return {
    /** Create the elements ahead of time so the first tap on the day has nothing to fetch. */
    warm(srcs: string[]): void { srcs.forEach(get); },
    /** Resolves to true when playback started, false when the browser refused (no gesture yet, no file). Never throws. */
    async play(src: string): Promise<boolean> {
      const el = get(src);
      if (current && current !== el) { try { current.pause(); } catch { /* already stopped */ } }
      current = el;
      try { el.currentTime = 0; await el.play(); return true; } catch { return false; }
    },
    stop(): void { if (current) { try { current.pause(); } catch { /* already stopped */ } } },
    playing(): SoundElement | null { return current; }
  };
}
