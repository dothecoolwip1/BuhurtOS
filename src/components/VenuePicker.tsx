import { useEffect, useRef, useState } from 'react';
import { fetchPlace, fetchSuggestions, newSession, placesAvailable, type PlaceDetails, type PlaceSuggestion } from '../lib/places';

export interface VenueFields { venue: string; address: string; city: string; region: string; country: string; latitude: number | null; longitude: number | null }

/**
 * Venue search with address autocomplete, when a browser key is configured and Google answers; otherwise plain fields.
 * Choosing a suggestion fills venue, address, city, province/state, country and coordinates; every field stays editable by hand.
 * The dropdown is positioned inside the form flow (not fixed) so the phone's bottom bar never covers it.
 */
export function VenuePicker({ value, onChange, errors = {} }: { value: VenueFields; onChange: (next: VenueFields) => void; errors?: Record<string, string> }) {
  const enabled = placesAvailable();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const session = useRef<Promise<unknown> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const set = <K extends keyof VenueFields>(k: K, v: VenueFields[K]) => onChange({ ...value, [k]: v });

  useEffect(() => {
    if (!enabled || query.trim().length < 3) { setItems([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      try {
        session.current ??= newSession();
        const list = await fetchSuggestions(query.trim(), await session.current);
        if (live) { setItems(list); setOpen(true); setUnavailable(false); }
      } catch { if (live) { setUnavailable(true); setItems([]); } }
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [query, enabled]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = async (s: PlaceSuggestion) => {
    setBusy(true); setOpen(false);
    try {
      const d: PlaceDetails = await fetchPlace(s.placeId, await session.current);
      session.current = null;
      onChange({ venue: d.venue || value.venue, address: d.address || value.address, city: d.city || value.city, region: d.region || value.region, country: d.country || value.country, latitude: d.latitude, longitude: d.longitude });
      setPicked(`${s.mainText}${s.secondaryText ? `, ${s.secondaryText}` : ''}`);
      setQuery('');
    } catch { setUnavailable(true); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {enabled && (
        <div ref={box} className="venuepick">
          <label className="field-in">Find the venue or address
            <input type="search" inputMode="search" autoComplete="off" placeholder="Start typing, for example Horse In Hand Ranch" value={query} aria-autocomplete="list" aria-expanded={open && items.length > 0} aria-controls="venue-suggestions"
              onChange={e => setQuery(e.target.value)} onFocus={() => items.length > 0 && setOpen(true)} />
            <span>{unavailable ? 'Address search is not available right now. Fill in the fields below by hand.' : 'Suggestions come from Google. Choosing one fills in the fields below; you can still change them.'}</span>
          </label>
          {open && items.length > 0 && (
            <ul id="venue-suggestions" className="panel venuelist" role="listbox" aria-label="Suggested places">
              {items.map(s => (
                <li key={s.placeId} role="option" aria-selected={false}>
                  <button type="button" disabled={busy} onClick={() => void choose(s)}><b>{s.mainText}</b>{s.secondaryText && <span className="muted">{s.secondaryText}</span>}</button>
                </li>
              ))}
            </ul>
          )}
          {picked && <p className="src" role="status">Filled in from: {picked}. Check the fields below.</p>}
        </div>
      )}
      {!enabled && <p className="src">Type the venue and address below. (Address search is not switched on for this site.)</p>}
      <label className="field-in">Venue<input value={value.venue} onChange={e => set('venue', e.target.value)} aria-invalid={Boolean(errors.venue)} />{errors.venue && <span role="alert" style={{ color: 'var(--live)' }}>{errors.venue}</span>}</label>
      <label className="field-in">Address<input value={value.address} autoComplete="street-address" onChange={e => set('address', e.target.value)} /></label>
      <div className="form">
        <label className="field-in">City<input value={value.city} autoComplete="address-level2" onChange={e => set('city', e.target.value)} /></label>
        <label className="field-in">Province or state<input value={value.region} autoComplete="address-level1" onChange={e => set('region', e.target.value)} /></label>
        <label className="field-in">Country<input value={value.country} autoComplete="country" onChange={e => set('country', e.target.value)} /></label>
      </div>
      {value.latitude !== null && value.longitude !== null && (
        <p className="src">Map position saved ({value.latitude.toFixed(4)}, {value.longitude.toFixed(4)}). <button type="button" className="linklike" onClick={() => onChange({ ...value, latitude: null, longitude: null })}>Clear position</button></p>
      )}
    </div>
  );
}
