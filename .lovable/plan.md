# Operation 5 — DMC Live Timetable data foundation

Bring the studio's official weekly class timetable into the app as a reliable, stored dataset. Nothing users see changes yet: no new pages, no new shifts, no change to Google Calendar, attendance, notifications or the display. This only builds the data layer that Operation 6's Admin page will read.

The live source returns 56 weekly slots, 32 classes and 37 instructors (verified against the endpoint today).

## What gets built

### 1. Domain model — `src/domain/timetable.ts`

Pure types, in the same style as the existing `src/domain/types.ts`:

- `DmcClassDefinition` — `sourceClassId`, `className`, `category`, `level`, `description`, `trailerId`
- `DmcInstructorDefinition` — `sourceInstructorId`, `firstName`, `lastName`, `title`, `bioInfo`, `imageUrl`
- `DmcTimetableSlot` — `sourceSlotId`, `sourceClassId`, `sourceInstructorId`, `dayLocal` (0=Sun…6=Sat), `scheduleKey`, `startTimeLocal` (HH:MM, Europe/Berlin), `durationMinutes`, `active`, `resumesOn`
- `DmcTimetableSnapshot` — the three lists plus the fetch timestamp

Scheduling meaning comes only from `dayLocal`, `scheduleKey` and `duration`. Slot `id`, `className`, `startTime` and `assignedClassId` are never used for scheduling; the slot id is kept purely as the source reference.

### 2. Parsing/normalisation — `src/domain/timetable-normalize.ts` (pure, unit-tested)

One function turning a raw payload into either a validated snapshot or a list of rejections:

- `scheduleKey` must match `^(sun|mon|tue|wed|thu|fri|sat)\d{4}$`, hours 00–23 and minutes 00–59; the time portion becomes `startTimeLocal`. Malformed → slot rejected, never guessed from the slot id.
- `dayLocal` must be an integer 0–6, and its weekday must agree with the `scheduleKey` prefix; a mismatch is an anomaly and the slot is rejected.
- `duration` must be a positive integer (any value, not only 45/60).
- `classId` must resolve in `classes[]`, `instructorId` in `instructors[]`; unresolved → slot rejected, never faked.
- `active` is read per slot; `resumesOn` stored verbatim as `YYYY-MM-DD` when present, otherwise null. No auto-reactivation logic anywhere.
- Times stay Berlin local wall clock — no UTC conversion.

If the top-level shape is wrong (missing/!array `slots`, `classes`, `instructors`, or zero valid slots), the whole snapshot is invalid and nothing is written.

### 3. Provider — `src/domain/dmc-timetable-provider.server.ts`

Mirrors the Operation 4 `calendar-provider.server.ts` boundary:

```text
DMC public API -> DmcPublicTimetableProvider -> validated snapshot -> service -> database
```

It fetches `https://scheduleclassesmanager-356018239005.europe-west1.run.app/get-public-data` server-side (with a timeout), parses JSON, runs normalisation, and returns `{ ok: true, snapshot, rejected } | { ok: false, error }`. It creates no shifts, touches no Google data, decides nothing about operators. Raw API shapes stop here.

### 4. Storage — one migration, three new tables

Separate from `scheduled_shifts` and `calendar_classes`, which are untouched:

- `dmc_classes` — unique on `source_class_id`
- `dmc_instructors` — unique on `source_instructor_id`
- `dmc_timetable_slots` — unique on `source_slot_id`; holds `day_local`, `schedule_key`, `start_time_local`, `duration_minutes`, `active`, `resumes_on`, plus class/instructor source ids
- last-refresh timestamp stored in the existing `app_settings` table (key `dmc_timetable`), so no new metadata system

All three are admin/server-read-only via the service key (no anon or authenticated grants), with RLS enabled and `service_role` grants, matching how the app's other data is reached.

### 5. Refresh service — `src/domain/timetable-repository.server.ts` + `src/lib/timetable.functions.ts`

`refreshDmcTimetable` (a server function guarded by the same `requireAdmin()` gate-session check `gcal.functions.ts` uses):

1. Fetch and validate. On any failure — network, malformed payload, no valid slots — return the error and leave stored data exactly as it was.
2. On success, upsert classes, instructors and slots keyed on their source ids, so a moved slot (same id, new `scheduleKey`) updates in place instead of duplicating.
3. Delete only stored rows whose source id is absent from the successful snapshot. Nothing outside these three tables is ever touched.
4. Record the refresh time.

Repeated refreshes therefore always leave 56 slots, not 112.

A read-only `getStoredTimetable` server function is added for Operation 6 to consume; no UI is built now.

### 6. Tests — `src/domain/timetable-normalize.test.ts`

Following the existing `*.test.ts` convention: schedule key parsing (`mon0000`, `fri0800`, `fri1930`), all seven day mappings, class and instructor resolution, active true/false, `resumesOn` present/absent, legacy fields (`id`, `className`, `startTime`, `assignedClassId`) deliberately contradicting the authoritative fields and being ignored, malformed key/day/duration rejection, missing class or instructor rejection, and invalid payload producing no snapshot. Upsert/idempotency and failure-safety are covered by the deterministic keying described above plus a repository-level test of the diff computation.

## Explicitly not in this operation

No Admin Live Timetable page or navigation, no shift generation or reconciliation, no Google matching or Free/Busy work, no new shift identity, no operator assignment, no notification or check-in changes, and no change to any existing table.

## Verification

TypeScript, ESLint, the full test suite and a production build, plus searches confirming nothing writes to `scheduled_shifts` or `calendar_classes` and that Google sync files are unchanged.
