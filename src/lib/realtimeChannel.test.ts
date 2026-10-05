import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { realtimeChannel } from './realtimeChannel';
import { supabase } from './supabase';

const files = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : []; });

describe('realtimeChannel (regression: production blank screen on Manage › Broadcast)', () => {
  it('two subscribers asking for the same name get two independent channels', () => {
    const a = realtimeChannel('event-record-x'), b = realtimeChannel('event-record-x');
    expect(a).not.toBe(b);
    expect(a.topic).not.toBe(b.topic);
    void supabase.removeChannel(a); void supabase.removeChannel(b);
  });
  it('no screen or hook opens a realtime channel by a shared name (every subscription goes through realtimeChannel)', () => {
    const offenders = files('src').filter(f => !f.endsWith('realtimeChannel.ts') && /supabase\s*\.\s*channel\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
