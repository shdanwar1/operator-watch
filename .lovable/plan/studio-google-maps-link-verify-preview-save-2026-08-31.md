# Studio Google Maps link: verify → preview → save

Scope: only the Studio address card in Settings and the studio setting it writes. Account, Security, Check-out confirmation, Classes, Teachers, and Data maintenance are untouched.

## Flow

1. Admin pastes a Google Maps link (short link, /place/ link, @lat,lng, ?q=lat,lng).
2. Clicking **Verify** checks the link server-side. Nothing is saved yet.
  - Invalid or unresolvable link: a small inline error under the input ("Could not verify that link…"), no write, existing studio address untouched.
  - Success: a preview block appears — "Verified location" plus the resolved address (street + number, and postcode/city when the link carries it) and the place name.
3. **Save studio** is enabled only after a successful verification and saves the verified result together with the original link. Editing the link again clears the preview and re-requires verification.
4. The saved studio address is shown in the card next to the heading, so the admin sees what the current link resolves to. Show the simplified address only, street name and street number, no need to show complete address with Post code and Berlin..

## Technical notes

- `src/lib/settings.functions.ts`
  - Add `adminVerifyStudioMapsLink` (POST, admin-gated): runs the existing `resolveGoogleMapsUrl`, returns `{ ok, label, address, full_address, lat, lng }` or `{ ok: false, message }` — read-only, no DB write.
  - Extend `StudioSetting` with `maps_url: string | null` and `full_address: string | null` (backward compatible; `readAppSettings` falls back to existing values when absent, defaults unchanged for existing consumers such as the Time-to-Leave timeline, which keeps using the short `address`).
  - `adminUpdateStudioSetting` keeps re-resolving server-side before writing (client preview is never trusted) and now persists `maps_url` alongside label/address/lat/lng. If resolution throws, nothing is written.
- `src/lib/maps-link.server.ts`: also derive a fuller address string (street segment plus postcode/city segment from the `/place/` slug when present) and return it as `full_address`; `address` stays street + number so the dashboard timeline is unchanged.
- `src/routes/admin.settings.tsx` — `StudioSection` only: local state for `mapsUrl`, `verified`, `error`; Verify button; preview block; Save disabled until verified; re-read `getAppSettings` to display the saved address in the card. Same minimalist card styling as now.

## Verification

- Typecheck + build clean.
- Manual: bad link shows inline error and leaves the saved studio untouched; a valid share link previews the address and saves it.  
  
  
