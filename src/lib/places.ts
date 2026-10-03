/**
 * Google Places address autocomplete (the current "Places API (New)" JavaScript library: AutocompleteSuggestion + Place), loaded only
 * when an organizer edits a venue and only when a browser key is configured (VITE_GOOGLE_MAPS_BROWSER_KEY). Without a key, or when the
 * script cannot load, the venue fields are plain text and the app works exactly as before. Nothing here asks the browser for its position.
 */
export interface PlaceSuggestion { placeId: string; mainText: string; secondaryText: string }
export interface PlaceDetails { venue: string; address: string; city: string; region: string; country: string; latitude: number | null; longitude: number | null }

/* eslint-disable @typescript-eslint/no-explicit-any */
type GoogleMaps = { maps: { importLibrary: (name: string) => Promise<any> } };
declare global { interface Window { google?: GoogleMaps; __bosMapsLoaded?: () => void } }

export const placesKey = (): string | null => (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined)?.trim() || null;
export const placesAvailable = (): boolean => placesKey() !== null;

let loading: Promise<any> | null = null;
/** Loads the Maps JavaScript API once and returns the places library, or rejects (the caller then stays with manual entry). */
export function loadPlacesLibrary(timeoutMs = 8000): Promise<any> {
  const key = placesKey();
  if (!key) return Promise.reject(new Error('no key'));
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      if (window.google?.maps?.importLibrary) { resolve(); return; }
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=places&callback=__bosMapsLoaded`;
      s.async = true;
      const t = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
      window.__bosMapsLoaded = () => { window.clearTimeout(t); resolve(); };
      s.onerror = () => { window.clearTimeout(t); reject(new Error('load failed')); };
      document.head.appendChild(s);
    }).then(() => window.google!.maps.importLibrary('places'));
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/** One session token groups the typing and the final pick for billing; a new one per picker. */
export async function newSession(): Promise<any> {
  const lib = await loadPlacesLibrary();
  return new lib.AutocompleteSessionToken();
}

export async function fetchSuggestions(input: string, sessionToken: any, regionCodes: string[] = ['ca', 'us']): Promise<PlaceSuggestion[]> {
  const lib = await loadPlacesLibrary();
  const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken, includedRegionCodes: regionCodes, language: 'en' });
  return (suggestions as any[]).flatMap(s => {
    const p = s.placePrediction;
    return p ? [{ placeId: p.placeId as string, mainText: p.mainText?.text ?? p.text?.text ?? '', secondaryText: p.secondaryText?.text ?? '' }] : [];
  });
}

/** Fetches the fields the event needs and maps them onto venue / address / city / province / country / coordinates. */
export async function fetchPlace(placeId: string, sessionToken: any): Promise<PlaceDetails> {
  const lib = await loadPlacesLibrary();
  const place = new lib.Place({ id: placeId, requestedLanguage: 'en' });
  await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'addressComponents', 'location', 'types'], sessionToken });
  const comps: Array<{ longText?: string; shortText?: string; types: string[] }> = place.addressComponents ?? [];
  const get = (type: string, short = false) => { const c = comps.find(x => x.types.includes(type)); return (short ? c?.shortText : c?.longText) ?? ''; };
  const isAddressOnly = Array.isArray(place.types) && place.types.some((t: string) => ['street_address', 'premise', 'subpremise', 'route', 'plus_code'].includes(t));
  const loc = place.location;
  return mapPlace({
    displayName: isAddressOnly ? '' : (place.displayName ?? ''), formattedAddress: place.formattedAddress ?? '',
    streetNumber: get('street_number'), route: get('route'), locality: get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_3'),
    region: get('administrative_area_level_1', true), country: get('country', true),
    latitude: typeof loc?.lat === 'function' ? loc.lat() : null, longitude: typeof loc?.lng === 'function' ? loc.lng() : null
  });
}

export interface RawPlace { displayName: string; formattedAddress: string; streetNumber: string; route: string; locality: string; region: string; country: string; latitude: number | null; longitude: number | null }
/** Pure mapping, tested on its own. The street line is number + route; without them, the formatted address up to the city. */
export function mapPlace(p: RawPlace): PlaceDetails {
  const street = [p.streetNumber, p.route].filter(Boolean).join(' ');
  const address = street || p.formattedAddress.split(',')[0]?.trim() || '';
  return {
    venue: p.displayName.trim(), address: address === p.displayName.trim() ? '' : address, city: p.locality, region: p.region, country: p.country,
    latitude: Number.isFinite(p.latitude as number) ? p.latitude : null, longitude: Number.isFinite(p.longitude as number) ? p.longitude : null
  };
}
