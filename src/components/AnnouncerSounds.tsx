import { useEffect, useMemo, useRef, useState } from 'react';
import { ANNOUNCER_SOUNDS, createSoundPlayer, soundUrl } from '../lib/announcer/sounds';
import { trackEvent } from '../lib/analytics';

/**
 * Hype calls for the Announcer (beta realm only): one row of big buttons, each a pre-recorded ring-announcer line, under the top bar of the
 * Announcer view. One hand, one tap, full volume; a new tap cuts the call still playing. Shown only on a beta build (src/lib/realm.ts).
 */
export function AnnouncerSounds() {
  const player = useMemo(() => createSoundPlayer(src => new Audio(src)), []);
  const base = import.meta.env.BASE_URL ?? '/';
  const [playing, setPlaying] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => { player.warm(ANNOUNCER_SOUNDS.map(s => soundUrl(base, s.file))); return () => { player.stop(); if (timer.current) window.clearTimeout(timer.current); }; }, [player, base]);

  const fire = async (id: string, file: string) => {
    const ok = await player.play(soundUrl(base, file));
    setBlocked(!ok);
    if (!ok) { setPlaying(null); return; }
    setPlaying(id);
    trackEvent('announcer_sound', { clip: id });
    // the button stays lit while the clip plays: cleared when the browser says it ended, or after a few seconds if it never does
    const el = player.playing();
    if (el instanceof HTMLAudioElement) el.onended = () => setPlaying(p => (p === id ? null : p));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPlaying(p => (p === id ? null : p)), 8000);
  };

  return (
    <section className="an-sounds" aria-label="Announcer sounds (beta)" data-testid="announcer-sounds">
      <p className="an-label an-sounds-label"><span aria-hidden="true">📣 </span>Hype calls <span className="an-beta">Beta</span></p>
      <div className="an-sounds-row" role="group" aria-label="Play a call">
        {ANNOUNCER_SOUNDS.map(s => (
          <button key={s.id} type="button" className={`an-sound${playing === s.id ? ' is-playing' : ''}`} aria-pressed={playing === s.id} onClick={() => void fire(s.id, s.file)}>
            {s.label}
          </button>
        ))}
      </div>
      {blocked && <p className="an-note" role="status">The tablet would not play sound. Tap once anywhere on the page, check it is not muted, then try again.</p>}
    </section>
  );
}
