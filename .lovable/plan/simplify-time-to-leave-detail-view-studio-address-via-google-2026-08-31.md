# Simplify Time to Leave detail view + studio address via Google Maps link

Two connected pieces: (A) a UI-only simplification of the expanded Time to Leave view, and (B) switching the studio location in Admin Settings from raw coordinates to a verified Google Maps link so a real street address exists to display.

## A. Time to Leave detail simplification (all in `src/routes/index.tsx`)

1. **Address shortening helper** — add `cleanAddress(label)`:
   - `"Grüntaler Str. 18, 13357 Berlin"` → `"Grüntaler Str. 18"`
   - Strips trailing `, <postcode> <city>` / `, <city>` segments, keeps street + house number only.
   - Applied to the Home and Studio endpoint rows in every timeline. Stop names keep the existing `cleanStop()` (already strips `(Berlin)` etc.).

2. **Best Option card** — keep card, header ("Best option" + Fastest badge + total minutes), icons, and timeline exactly as-is; only the endpoint labels change to the shortened addresses. No other content is removed beyond what the shortened addresses already cover (the timeline currently has no extra redundant metadata).

3. **Direct Options — full timeline** — replace the compact `DirectOptionSection` with the same timeline structure as Best Option, built from the existing `DirectPlan` fields (no new data, no recalculation):
   ```text
   06:18 PM
   Home · Grüntaler Str. 18
   8 min walk to Osloer Str./Prinzenallee
   ↓
   06:26 PM
   [M27] Osloer Str./Prinzenallee → Reuchlinstr.          24 min
   5 min walk to studio
   ↓
   06:50 PM
   Studio · Kaiserin-Augusta-Allee 10
   ```
   - Rows: Home endpoint (`leave_iso`) + `walk_to_minutes` walk note → transit row (mode marker, `LineLabel`, cleaned stops, `ride_minutes`) + `walk_from_minutes` "walk to studio" note → Studio endpoint (`arrive_iso`).
   - A shared `JourneyTimeline` component renders both Best Option and Direct cards so they can never drift apart.

4. **"DIRECT OPTIONS" heading** — one shared uppercase section heading above the direct cards; the per-card "Direct option 1 / 2" titles are removed. Each card header shows only its total minutes. One or two cards render depending on availability (existing `slice(0, 2)` logic unchanged).

## B. Studio location as a verified Google Maps link

5. **Shared Maps-link resolver** — extract the existing `resolveGoogleMapsUrl` (used for operator home addresses) into a shared server module and reuse it for the studio. It already: validates common Google Maps URL formats, follows short links (`maps.app.goo.gl` etc.) safely, extracts coordinates from `!3d/!4d`, `@lat,lng`, and `?q=` patterns, and throws a clear error when the link can't be verified — nothing is saved unless verification succeeds.

6. **Studio settings change** (`src/lib/settings.functions.ts`):
   - `updateStudio` now accepts `{ maps_url }` instead of `{ label, lat, lng }`.
   - Server resolves the link → stores `{ label, address, lat, lng }` in the existing `app_settings` row (no DB change — the value is JSONB).
   - `address` = street + house number derived from the link's `/place/...` slug (the slug segment containing a house number, e.g. `Kaiserin-Augusta-Allee 10`), falling back to the cleaned label when no street segment is found.
   - On first save via a link, the current coordinates-only entry is migrated; until then the timeline falls back to the existing studio label.

7. **Admin Settings UI** (`src/routes/admin.settings.tsx`) — the Studio card replaces the Label/Latitude/Longitude inputs with:
   - Read-only display of the resolved studio address + name.
   - A single "Google Maps link" input + Save. Save calls the resolver; errors ("Could not read coordinates from that link…") are shown inline and nothing is written.

8. **Studio endpoint display** — the timeline's Studio row shows `Studio · <address>` (street + number only, never the studio name, postcode, or city).

## Non-changes
- Route calculation, Time to Leave algorithm, BVG/Transitous provider layer, direct-route detection, fastest-route picking, and backward departure scheduling are untouched.
- `DirectPlan`/`JourneyPlan` shapes and `TRAVEL_SNAPSHOT_VERSION` are unchanged — everything shown already exists in the snapshot. (Travel snapshots recompute on their normal refresh cycle, so a newly saved studio address appears without a version bump.)
- Card structure, colors, icons, fonts, and expand/collapse behavior stay the same.

## Verification
- `tsgo` typecheck + build OK.
- Unit-test the `cleanAddress` / slug-address parsing edge cases (with/without postcode, business-name-only slug).
- Playwright: expanded Time to Leave card shows shortened Home/Studio addresses, a "DIRECT OPTIONS" heading, and full-timeline direct cards; Admin Settings saves a valid Maps link and rejects an invalid one.
