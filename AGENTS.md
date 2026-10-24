<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture

- Timecode timeline progress derives from scheduled wall-clock bounds, not recording elapsed time; saved-session deletion uses the existing shared gate-operator boundary and also clears the current device draft.

- Ballet Studio Display guidance is derived only from remaining class time in the pure stage calculation; never persist segment state or add a second timer, so reloads and mid-class launches stay accurate.

- Shift-relative reminder planning uses `src/lib/shift-hour-reminder.ts` and distinct per-shift start-instant keys in `push-keys.ts`; keep the database `push_dispatch_due()` predicate aligned so the timer wakes for every reminder type.

- Server functions authenticate only through the signed gate cookie (`src/lib/gate.functions.ts`); `functionMiddleware` in `src/start.ts` stays empty and no server function may require a Supabase user session, because DMC operators never hold one — a bearer-token middleware would add an async session lookup to every operator action for nothing.

- Operator shifts are generated only from the stored DMC timetable by `src/domain/shift-generation.server.ts` (pure rules in `shift-rotation.ts`, `tt:` identities), run after every timetable sync and admin rotation save; Google Calendar sync is retired so there is one source of truth.

- Per-date schedule overrides (cancellations, substitutes) are resolved only by `src/domain/schedule-overrides.ts` and stored with the timetable meta in `app_settings`; weekly suspensions always win, so one resolver keeps board and shift planning consistent.
