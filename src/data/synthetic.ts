import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Records tagged by a synthetic (fictional/test) source. Keys are `type:id` and, where the record has one, `type:slug`. */
export type SyntheticSet = ReadonlySet<string>;
const EMPTY: SyntheticSet = new Set();
let cached: Promise<SyntheticSet> | null = null;
const PAGE = 1000;

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

/** Discovery filters must distinguish an unavailable index from an empty one. */
export function loadSyntheticStrict(): Promise<SyntheticSet> {
  if (!cached) {
    cached = (async () => {
      // The API returns at most 1000 rows per request: read the whole index in pages, or newer test records go unlabelled.
      const rows: { entity_type: string; entity_id: string; slug: string | null }[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('synthetic_records').select('entity_type,entity_id,slug')
          .order('entity_type').order('entity_id').range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      return syntheticKeys(rows);
    })().catch(error => { cached = null; throw error; });
  }
  return cached;
}

export function loadSynthetic(): Promise<SyntheticSet> {
  return loadSyntheticStrict().catch(() => EMPTY); // individual-page labels never block the record itself
}

export function useSynthetic(): SyntheticSet {
  const [set, setSet] = useState<SyntheticSet>(EMPTY);
  useEffect(() => { let live = true; void loadSynthetic().then(s => { if (live) setSet(s); }); return () => { live = false; }; }, []);
  return set;
}
