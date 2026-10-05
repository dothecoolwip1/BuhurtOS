import { describe, expect, it } from 'vitest';
import { realtimeChannel } from './realtimeChannel';
import { supabase } from './supabase';

// Every source file's text (Vite inlines them at test time), so the check below sees the whole app.
const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true });

describe('realtimeChannel (regression: production blank screen on Manage › Broadcast)', () => {
  it('two subscribers asking for the same name get two independent channels', () => {
    const a = realtimeChannel('event-record-x'), b = realtimeChannel('event-record-x');
    expect(a).not.toBe(b);
    expect(a.topic).not.toBe(b.topic);
    void supabase.removeChannel(a); void supabase.removeChannel(b);
  });
  it('no screen or hook opens a realtime channel by a shared name (every subscription goes through realtimeChannel)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    const offenders = Object.entries(SOURCES).filter(([f, text]) => !f.endsWith('/realtimeChannel.ts') && /supabase\s*\.\s*channel\s*\(/.test(text)).map(([f]) => f);
    expect(offenders).toEqual([]);
  });
});
