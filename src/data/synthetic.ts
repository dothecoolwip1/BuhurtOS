import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Records tagged by a synthetic (fictional/test) source. Keys are `type:id` and, where the record has one, `type:slug`. */
export type SyntheticSet = ReadonlySet<string>;
const EMPTY: SyntheticSet = new Set();
let cached: Promise<SyntheticSet> | null = null;

export function syntheticKeys(rows: { entity_type: string; entity_id: string; slug: string | null }[]): SyntheticSet {
  const keys = new Set<string>();
  for (const r of rows) {
    keys.add(`${r.entity_type}:${r.entity_id}`);
    if (r.slug) keys.add(`${r.entity_type}:${r.slug}`);
  }
  return keys;
}

export function isSynthetic(set: SyntheticSet, type: 'event' | 'team' | 'fighter' | 'organization', idOrSlug: string | null | undefined): boolean {
  return Boolean(idOrSlug) && set.has(`${type}:${idOrSlug}`);
}

export function loadSynthetic(): Promise<SyntheticSet> {
  if (!cached) {
    cached = (async () => {
      const { data, error } = await supabase.from('synthetic_records').select('entity_type,entity_id,slug');
      if (error) throw error;
      return syntheticKeys(data ?? []);
    })().catch(() => { cached = null; return EMPTY; }); // labels are a courtesy: never block a page on them
  }
  return cached;
}

export function useSynthetic(): SyntheticSet {
  const [set, setSet] = useState<SyntheticSet>(EMPTY);
  useEffect(() => { let live = true; void loadSynthetic().then(s => { if (live) setSet(s); }); return () => { live = false; }; }, []);
  return set;
}
