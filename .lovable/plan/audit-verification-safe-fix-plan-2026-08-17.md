# Audit verification + safe fix plan

## Phase 1 — Verification report

| # | Audit finding | Verdict | Evidence |
|---|---|---|---|
| 1 | `listShifts` exposes all shifts when site-unlocked but not signed in | **CONFIRMED — critical** | `src/lib/shifts.functions.ts`: filter applied only `if (!isAdmin && username)`; with no username the query is unfiltered. (`listScheduledShifts` right next to it already returns `[]` — proof of the intended rule.) |
| 2 | Operator identity is a mutable username | **CONFIRMED — but no schema change needed now** | `shifts.operator_name`, `scheduled_shifts.assigned_operator`, `calendar_classes.operator` are strings. `updateMyProfile` / `adminUpdateOperator` rename via `admin_update_operator` and update nothing else → rename orphans history. |
| 3 | `createShift` does not verify `scheduled_shift_id` ownership | **CONFIRMED — high** | `createShift` inserts the client-supplied id with no lookup. (Update/delete paths already have `assertShiftOwnership` / `assertScheduledOwnership`.) |
| 4 | Sync coordinator shares in-flight state, not result | **CONFIRMED** | `coordinatedSync` awaits `inFlight` then returns `{result:null, skipped:true}` — the second caller never runs `onSynced`/toast. |
| 5 | Cooldown starts after a *failed* sync | **CONFIRMED** | `lastCompletedAt = Date.now()` is set on any resolved promise; a `{ok:false}` result still starts the 90 s cooldown. |
| 6 | `useCachedResource` persists domain failures | **NOT REPRODUCIBLE (dead code)** | The hook has zero consumers; `src/routes/index.tsx` only imports it unused. |
| 7 | Time-to-leave refetches route repeatedly | **ALREADY FIXED** | `useTravelPlan` + `travel-snapshot.ts`: one fetch per identity, success-only persistence, countdown computed locally. |
| 8 | Travel cache key incomplete | **ALREADY FIXED** | Key = operator namespace + shift start + shift end + home coords + version. Destination is a server-side admin setting, not client input. |
| 9 | Route geometry cache is in-memory only | **PARTIALLY VALID** | Geometry *is* persisted inside the travel snapshot, but `RouteMapPreview` keeps its own 60 s in-memory `Map` and refetches after reload. |
| 10 | "Last synced" is local-only | **ALREADY FIXED** | `operators.calendar_last_sync_at` exists; `gcal.server.ts` stamps it only on success and returns the server value; failures return the previous timestamp. |
| 11 | Calendar parsing depends on runtime timezone | **PARTIALLY VALID — low impact** | `parseIcsDateTime` keeps wall-clock fields correct for floating/TZID values. Real gap: UTC-anchored recurring events are converted to Berlin *before* expansion, so occurrences past a DST boundary keep the pre-transition wall clock (1 h off). |
| 12 | Duplicated shift gap rules (90 vs 60) | **PARTIALLY VALID** | `SHIFT_CONFIG.maxGapMin = 90` groups *classes*; `MERGE_GAP_MIN = 60` merges already-buffered *shift rows*. Different domains — not a duplicated rule. Documentation, not behaviour, is the problem. |
| 13 | Directory usage counter lost-update race | **CONFIRMED — medium** | `bump()` in `directories.functions.ts` reads then writes `usage_count + 1`. |
| 14 | DB errors treated as empty results | **PARTIALLY VALID** | Most reads check `error`. Exceptions: `bump()` ignores all errors, `createShift`/`createPastShift` canonical-name lookup ignores `error`, `getGateStatus` deactivation check ignores `error` (a DB blip signs the operator out). |
| 15 | Alias correction can partially succeed | **CONFIRMED** | `correctClassMapping` ignores the `class_aliases` upsert error; UI reports full success. |
| 16 | Scheduled-shift filter predicates duplicated | **REQUIRES FURTHER INVESTIGATION** | Low value; no observed divergence. Not planned. |
| 17 | Operator cache cleanup not wired to sign-out | **CONFIRMED** | `clearCacheForOperator` has no callers; 4 sign-out call sites don't use it. |
| 18 | Site-gate vs auth conflated | **PARTIALLY VALID** | Each module re-declares its own `requireGate`. The only real defect it caused is #1; the rest are consistent. Fix #1, don't restructure. |
| 19 | Route geometry accepts arbitrary client coords | **PARTIALLY VALID** | `COORD()` validates ranges and the session is required, but any signed-in user can route arbitrary points. |
| 20 | SSRF hardening | **ALREADY FIXED (adequate)** | `safeRemoteUrl` + manual per-hop redirect revalidation. DNS-rebinding needs IP-level control not available in the Worker runtime. No change. |
| 21 | Studio Display responsive thresholds inconsistent | **CONFIRMED — cosmetic** | `useOrientation` uses `1.15`, `MainStage` is handed `ratio >= 1.35`, pre-class uses CSS container queries. |
| 22 | 250 ms ticker | **CONFIRMED but intentional** | Needed for stage-boundary precision. Not changing. |
| 23 | No tests | **CONFIRMED** | No test runner installed. |

## Phase 2 — Implementation batches

Each batch is validated with typecheck + lint + build, plus the noted manual check.

**Batch 1 — Authorization (security)**
- `shifts.functions.ts::listShifts`: return `[]` when not admin and no username; keep admin = all, operator = own.
- `shifts.functions.ts::createShift`: when `scheduled_shift_id` is provided, load the row and reject if `assigned_operator` isn't the caller (reuse the existing `assertScheduledOwnership`). Unscheduled check-in (`null`) unchanged.
- Risk: an operator whose scheduled shift is assigned under an old spelling would be blocked — mitigated by the case-insensitive compare already in `assertAssignedToSelf`.
- Validate: signed-in operator dashboard still lists own shifts; admin dashboard still lists all; check-in scheduled + unscheduled.

**Batch 2 — Sync coordinator correctness**
- `gcal-sync-coordinator.ts`: store the in-flight `Promise<T>` and return the same result to concurrent callers (`skipped:false` for both); add an `isSuccess?: (r:T)=>boolean` option and set `lastCompletedAt` only when it passes.
- `useCalendarSync.ts`: pass `isSuccess: (r) => r.ok === true`.
- Risk: waiters now run `onSynced` + broadcast; the sync-bus already guards refresh loops.
- Validate: two tabs syncing at once; forced failure keeps retrying instead of cooling down.

**Batch 3 — Data integrity**
- New migration: `bump_directory_usage(p_table text, p_names text[])` doing an atomic `insert … on conflict do update set usage_count = usage_count + 1`; `bump()` calls it and surfaces errors.
- `correctClassMapping`: check the alias upsert error and return `{ row, aliasSaved:boolean }`-style signal so the UI can warn on partial success (keep the row update as-is).
- `createShift` / `createPastShift` / `getGateStatus`: distinguish DB error from "no row" (throw instead of falling back / signing out).
- Validate: correcting a class match, check-in, deactivated-operator sign-out.

**Batch 4 — Username rename integrity (no schema change)**
- Migration: `rename_operator(p_id uuid, p_new text)` — one transactional function updating `operators.username`, `shifts.operator_name`, `scheduled_shifts.assigned_operator`, `calendar_classes.operator` where they match the old name.
- `updateMyProfile` and `adminUpdateOperator` call it for the username part; PIN changes keep using the existing RPC.
- Explicitly **not** doing the UUID foreign-key migration — that is a high-risk schema change; documented as a future option.
- Validate: rename an operator, confirm their shifts/schedule/classes still appear.

**Batch 5 — Calendar DST correctness**
- `gcal-core.ts`: keep UTC-anchored events as true instants, expand the RRULE in instant space, and convert each occurrence to Berlin wall clock at emit time (one `Intl`-based converter). Floating/TZID handling unchanged.
- Validate against representative ICS fixtures in tests (batch 7).

**Batch 6 — Caches and cleanup**
- Call `clearCacheForOperator(username)` at the 4 sign-out sites (`index.tsx`, `profile.tsx`, `AppShell.tsx`, `AdminShell.tsx`).
- Persist successful route geometry from `RouteMapPreview` in the operator-scoped local cache (success only, keyed by coordinate pair + version) so a reload reuses it.
- Delete the unused `useCachedResource` hook and its dead import.
- Single orientation threshold constant in `display.tsx` (use the existing `1.15` everywhere; `MainStage` currently switches at 1.35 — this is the only intentional visual behaviour change and can be dropped if you prefer).
- Validate: sign out/in as a second operator on the same device; reload the dashboard offline.

**Batch 7 — Focused tests**
- Add `vitest` + a handful of domain tests: `listShifts` authorization rules (pure helper), `groupClassesIntoShifts` (30/60/75/90/just-over/overnight), Berlin ICS parsing incl. DST + month boundary, coordinator single-flight/cooldown-on-success, travel snapshot key invalidation, Studio Display stage boundaries.

## Not doing (and why)
- UUID foreign-key migration for operator identity — high-risk schema change; batch 4 solves the actual defect.
- Unifying the 90/60 gap constants — they are different rules; only cross-references will be added as comments.
- Rewriting the Studio Display state machine or its 250 ms ticker.
- Additional SSRF restrictions or a provider allowlist.
