# Venue and address autocomplete (Google Places)

Event setup (`/events/new` and Manage → Setup → Where) offers address and venue suggestions from Google when, and only when, a browser key
is configured. Without a key the same fields are plain text and nothing else changes. The app never asks the phone for its position.

## What the app uses

- Maps JavaScript API, loaded on demand (only when an organizer edits a venue), with the current Places library:
  `AutocompleteSuggestion.fetchAutocompleteSuggestions` for suggestions and `Place.fetchFields` for the chosen place. The legacy
  `google.maps.places.Autocomplete` widget is not used (Google no longer offers it to new customers).
- One `AutocompleteSessionToken` per search, so typing plus the final pick bill as one session.
- Fields requested: `displayName`, `formattedAddress`, `addressComponents`, `location`, `types`. Choosing a suggestion fills venue, street
  address, city, province/state, country and the map position (`events.latitude` / `events.longitude`, public venue facts). Every field
  stays editable by hand.
- Suggestions are limited to Canada and the United States (`includedRegionCodes: ['ca', 'us']`); change it in `src/lib/places.ts`.

## What Garrett has to do (once)

1. Google Cloud console → APIs & Services → enable **Maps JavaScript API** and **Places API (New)** on a project with billing enabled.
2. Credentials → Create credentials → **API key**. Then restrict it:
   - Application restrictions: **Websites**, add the production domain(s) (for example `https://buhurtos.ca/*`, the GitHub Pages or Vercel
     domain, and `http://localhost:5173/*` for local work). The key then only works from pages served on those hosts.
   - API restrictions: **Restrict key** → Maps JavaScript API and Places API (New) only.
3. Put the key in the build environment as `VITE_GOOGLE_MAPS_BROWSER_KEY` (GitHub Actions: repository variable or secret used by the build
   step; Vercel: an environment variable). It is a publishable browser key: its only protection is the referrer restriction above, which is
   the proper design for client-side Maps use. **Do not** create or use a server key here.
4. Deploy. The Setup "Where" box then shows "Find the venue or address".

## Cost

Google's Maps Platform pricing (2025 onward) gives every account a monthly free allowance per SKU before billing starts: Autocomplete
requests and Place Details (Essentials fields such as address components, formatted address and location) have monthly free tiers of
thousands of calls, and Place Details Pro fields (`displayName`) a smaller one. A handful of organizers creating a few events a month stays
within the free allowance; there is no per-visitor cost because only the setup screens load the library. If that changes (hundreds of
events a day), the alternative is a self-hosted geocoder (for example Nominatim/OpenStreetMap), which the `VenuePicker` component can be
pointed at without changing the event schema. Check current prices on the Maps Platform pricing page before relying on these numbers.

## Failure behaviour (tested)

- No key: the picker is not shown; the fields are plain.
- Key present but the script fails to load or Google answers with an error: the search box says "Address search is not available right
  now. Fill in the fields below by hand." and the plain fields still save.
- The suggestion list is rendered inside the form (not a fixed overlay), so the phone's bottom bar never covers it.
