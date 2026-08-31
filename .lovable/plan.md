# Settings page UI cleanup

UI-only simplification of `src/routes/admin.settings.tsx`. No server functions, DB logic, permissions, or existing behavior change. Check-out confirmation, Classes, Teachers, and Data maintenance sections stay byte-for-byte identical.

## Changes

### 1. Account section (`AccountSection`)
- Remove the **Username** row entirely (the `flex ... Username / {username}` block).
- Remove the `username` prop from `AccountSection` and its usage in `AdminSettings` (drop `const { username } = Route.useLoaderData()`; keep the loader as-is so `getGateStatus` still runs for the gate).
- Remove the `Never displayed. Stored hashed.` paragraph under "Admin PIN".
- Keep the Admin PIN row: `••••` + `Change PIN` button, plus the existing `PinDialog`.

### 2. Security section (`SitePasswordSection`)
- Remove the `Unlocks the application. Separate from the admin PIN.` paragraph.
- Keep the `Site password` label + `Change` button and the full change-password dialog (unchanged).

### 3. Studio section (`StudioSection`)
- Remove the explanatory paragraph: `Used as the destination for every operator's "Time to leave" estimate.`
- Remove the duplicate address display block: the `{data && (<div className="rounded-md border bg-muted/40 ...">...</div>)}` showing `data.studio.label` and `data.studio.address`.
- Remove the long instructions paragraph: `Open the studio in Google Maps, tap Share, and paste the link. The address is verified before anything is saved.`
- Keep the `Studio address` heading, the `Google Maps link` label + input, and the `Save studio` button (with its existing save/error logic unchanged).
- `data`/`useQuery` can be removed from `StudioSection` since it was only used by the deleted address display.

### 4. Section grouping in `AdminSettings`
Split the current single "System" group so Studio stands alone (per the requested final structure), while the unchanged sections keep their existing order:
- `Account` → AccountSection
- `Security` → SitePasswordSection
- `Studio` → StudioSection  *(new own `SectionLabel`)
- `System` → CheckoutSection, Classes, Teachers, MaintenanceSection *(unchanged content; only the grouping label moves with Studio out)

### Non-changes
- `Check-out confirmation` (`CheckoutSection`), `Classes`/`Teachers` (`DirectorySection`), and `Data maintenance` (`MaintenanceSection`) are not touched.
- Route loader, `getGateStatus`, `PinDialog`, change-password dialog, and all server functions (`adminChangeOwnPin`, `adminChangeSitePassword`, `getAppSettings`, `adminUpdateStudioSetting`, directory functions, `backfillClassMatches`) stay exactly as they are.
- Dark minimalist UI, typography, borders, spacing, and component styles are preserved.

## Verification
- `tsgo` typecheck + build OK (no unused-var errors after removing `username`/`data`).
