# Studio Display opens inside the installed app, not a browser popup

Your diagnosis is right: `window.open(url, "studio-display", "popup,...")` cannot create a second window inside an installed iOS web app. iOS hands that new browsing context to the default browser, so you end up with a Chrome window that is a separate app from the installed Operator Suite. This is platform behaviour, not something popup options can fix.

## What changes

### 1. Launch behaviour depends on the context

- **Installed web app (standalone display-mode) or touch/mobile:** "Open Display" navigates the current window to `/display`. No popup, no browser hand-off.
- **Desktop browser tab:** keeps today's behaviour — the single named popup window, reused/focused on repeat presses, so the operator keeps the control page beside the display.

Detection uses the same standalone check the push code already relies on (`display-mode: standalone` / `navigator.standalone`).

### 2. `/display` gets a way back

When the display is reached by in-app navigation (not as a popup), a small, unobtrusive control appears — a back chevron in a corner, fading out after a few seconds and reappearing on tap — that returns to `/studio-display`. The teacher-facing visuals, colours, countdown, notes panel and Up Next stay exactly as they are. In popup mode nothing new is rendered.

### 3. The control surface works on the installed app

`/studio-display` currently shows a "Desktop only" screen below `lg`. That blocks the very flow you're using on iOS. The launcher and the Active Display card become available when the app is running standalone (installed), while a plain small-screen browser tab keeps the desktop-only notice.

### 4. Shared state is untouched

One session, one timer, one shared state. A separate physical display device can still open `/display` on its own and stay in sync through the existing BroadcastChannel + localStorage mechanism. When the operator navigates in-app, control and display are simply the same window at different moments — notes typed before navigating are already in the shared state.

## Technical notes

- `src/lib/studio-display.ts` (or a small helper): `prefersInAppDisplay()` — true when `matchMedia("(display-mode: standalone)").matches`, `navigator.standalone`, or a coarse pointer / no popup support.
- `src/components/StudioDisplayPanel.tsx`: `focusOrOpen` branches — in-app path calls `navigate({ to: "/display", search: {...} })` instead of `window.open`; desktop path unchanged.
- `src/routes/display.tsx`: accepts an optional `back=1` search flag (set by in-app navigation) and renders the return control only then, via `<Link to="/studio-display">`.
- `src/routes/studio-display.tsx`: replace the `max-lg:hidden` / `lg:hidden` split with a runtime check that also treats standalone installs as a supported surface (rendered after hydration to avoid SSR mismatch).
- No change to `/display` timer logic, `useStudioDisplay`, or the state schema.
