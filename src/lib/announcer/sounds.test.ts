import { describe, expect, it, vi } from 'vitest';
import { realmOf } from '../realm';
import { ANNOUNCER_SOUNDS, createSoundPlayer, soundUrl, type SoundElement } from './sounds';

describe('announcer sounds (beta realm)', () => {
  // the clip files shipped with the app, resolved at build time (so a renamed or forgotten file fails here, not on the day)
  const shipped = new Set(Object.keys(import.meta.glob('../../../public/announcer/*.mp3')).map(k => k.slice(k.lastIndexOf('/') + 1)));

  it('every call has a unique id and label, and its file is in the repo', () => {
    const ids = new Set(ANNOUNCER_SOUNDS.map(s => s.id));
    expect(ids.size).toBe(ANNOUNCER_SOUNDS.length);
    expect(new Set(ANNOUNCER_SOUNDS.map(s => s.label)).size).toBe(ANNOUNCER_SOUNDS.length);
    for (const s of ANNOUNCER_SOUNDS) {
      expect(s.id).toMatch(/^[a-z][a-z0-9_]{1,39}$/); // the same rule analytics applies to names
      expect(shipped.has(s.file), `${s.file} missing from public/announcer`).toBe(true);
    }
  });

  it('builds the clip address under the build base path', () => {
    expect(soundUrl('/', 'fight.mp3')).toBe('/announcer/fight.mp3');
    expect(soundUrl('/BuhurtOS/', 'fight.mp3')).toBe('/BuhurtOS/announcer/fight.mp3');
  });

  it('a new call cuts the one playing, a repeat restarts from the top, and a refusal never throws', async () => {
    const made: Array<SoundElement & { plays: number; pauses: number; ok: boolean }> = [];
    const player = createSoundPlayer(src => {
      const el = { src, currentTime: 5, volume: 0.2, preload: 'none', plays: 0, pauses: 0, ok: true,
        async play() { this.plays++; if (!this.ok) throw new Error('NotAllowedError'); }, pause() { this.pauses++; } };
      made.push(el); return el;
    });
    player.warm(['/a.mp3', '/b.mp3']);
    expect(made.map(m => [m.preload, m.volume])).toEqual([['auto', 1], ['auto', 1]]);
    expect(await player.play('/a.mp3')).toBe(true);
    expect(made[0].currentTime).toBe(0);
    made[0].currentTime = 3;
    expect(await player.play('/a.mp3')).toBe(true); // restart, not a pause of itself
    expect(made[0].currentTime).toBe(0);
    expect(made[0].pauses).toBe(0);
    expect(await player.play('/b.mp3')).toBe(true);
    expect(made[0].pauses).toBe(1);
    expect(made.length).toBe(2); // elements are reused, not rebuilt per tap
    made[1].ok = false;
    expect(await player.play('/b.mp3')).toBe(false);
  });

  it('only the exact word beta makes a beta build', () => {
    expect(realmOf('beta')).toBe('beta');
    expect(realmOf(' Beta ')).toBe('beta');
    expect(realmOf('live')).toBe('live');
    expect(realmOf(undefined)).toBe('live');
    expect(realmOf('')).toBe('live');
    expect(realmOf(1)).toBe('live');
    vi.stubEnv('VITE_REALM', 'beta');
    expect(realmOf(import.meta.env.VITE_REALM)).toBe('beta');
    vi.unstubAllEnvs();
  });
});
