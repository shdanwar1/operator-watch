# Mobile: Profile tab + desktop-only Studio Display

## Changes

### 1. Add Profile to the mobile bottom tab bar
In `src/components/AppShell.tsx`:
- Extend `MOBILE_NAV` with `{ label: "Profile", to: "/profile", icon: User }` (5 tabs).
- Change the tab bar grid from `grid-cols-4` to `grid-cols-5`.
- Desktop sidebar stays exactly as-is (it already has Profile and Studio Display).

### 2. Logout inside the Profile tab (mobile)
- `src/routes/profile.tsx` already renders a mobile-only "Log out" button (`lg:hidden`). Keep it, but align it with the sidebar's `handleSignOut`: release the push endpoint (`unsubscribeFromPush` + `releasePushEndpoint`) before `signOutUser`, so the next operator on the device doesn't inherit reminders — matching the desktop behavior.
- No logout button is added to the mobile tab bar itself; logout lives in Profile only.

### 3. Studio Display is desktop-only
- `src/routes/studio-display.tsx`: on small screens, render a simple "Desktop only" notice ("The Studio Display is designed for desktop. Open this page on a computer to configure and launch the display.") instead of the `StudioDisplayPanel` / "Open display" button. Implement responsively (CSS breakpoint via a `lg:` hidden/block pair) so SSR stays safe — no user-agent sniffing.
- The `/display` popup route itself is unchanged (it's only ever opened via `window.open` from desktop).

## Out of scope
- No changes to the Studio Display timer logic, admin pages, or any other navigation.
