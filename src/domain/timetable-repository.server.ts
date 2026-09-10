/**
 * DMC timetable persistence (Operation 5) — server only.
 *
 * Deliberately narrow: upsert the three timetable tables keyed on their source
 * identifiers, drop rows the source no longer publishes, and record when the
 * last successful refresh happened. Nothing here touches `scheduled_shifts`,
 * `calendar_classes`, or any Google Calendar data.
 *
 * Because every write is keyed on a source id, refreshing repeatedly is
 * idempotent and a slot that moved (same source id, new scheduleKey) updates
 * in place instead of duplicating.
 */
import type {
  DmcClassDefinition,
  DmcInstructorDefinition,
  DmcTimetableSlot,
  DmcTimetableSnapshot,
} from "./timetable";

export const TIMETABLE_META_KEY = "dmc_timetable";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Stored ids that the freshly fetched source no longer contains. */
export function staleSourceIds(stored: string[], current: string[]): string[] {
  const keep = new Set(current);
  return stored.filter((id) => !keep.has(id));
}

export type StoredTimetable = {
  classes: DmcClassDefinition[];
  instructors: DmcInstructorDefinition[];
  slots: DmcTimetableSlot[];
  lastRefreshedAt: string | null;
};

type ClassRow = {
  source_class_id: string;
  class_name: string;
  category: string | null;
  level: string | null;
  description: string | null;
  trailer_id: string | null;
};

type InstructorRow = {
  source_instructor_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  bio_info: string | null;
  image_url: string | null;
};

type SlotRow = {
  source_slot_id: string;
  source_class_id: string;
  source_instructor_id: string;
  day_local: number;
  schedule_key: string;
  start_time_local: string;
  duration_minutes: number;
  active: boolean;
  resumes_on: string | null;
};

function classRow(c: DmcClassDefinition): ClassRow {
  return {
    source_class_id: c.sourceClassId,
    class_name: c.className,
    category: c.category,
    level: c.level,
    description: c.description,
    trailer_id: c.trailerId,
  };
}

function instructorRow(i: DmcInstructorDefinition): InstructorRow {
  return {
    source_instructor_id: i.sourceInstructorId,
    first_name: i.firstName,
    last_name: i.lastName,
    title: i.title,
    bio_info: i.bioInfo,
    image_url: i.imageUrl,
  };
}

function slotRow(s: DmcTimetableSlot): SlotRow {
  return {
    source_slot_id: s.sourceSlotId,
    source_class_id: s.sourceClassId,
    source_instructor_id: s.sourceInstructorId,
    day_local: s.dayLocal,
    schedule_key: s.scheduleKey,
    start_time_local: s.startTimeLocal,
    duration_minutes: s.durationMinutes,
    active: s.active,
    resumes_on: s.resumesOn,
  };
}

export type CommitResult = {
  classes: number;
  instructors: number;
  slots: number;
  removedSlots: number;
};

/**
 * Replace the stored timetable with a validated snapshot. Only called after
 * the provider has fully validated the source, so partial or broken data can
 * never reach this point.
 */
export async function commitSnapshot(snapshot: DmcTimetableSnapshot): Promise<CommitResult> {
  const db = await admin();

  const up = async (table: string, rows: object[], conflict: string) => {
    if (rows.length === 0) return;
    const { error } = await db.from(table as never).upsert(rows as never, { onConflict: conflict });
    if (error) throw new Error(error.message);
  };

  await up("dmc_classes", snapshot.classes.map(classRow), "source_class_id");
  await up("dmc_instructors", snapshot.instructors.map(instructorRow), "source_instructor_id");
  await up("dmc_timetable_slots", snapshot.slots.map(slotRow), "source_slot_id");

  // Drop what the source no longer publishes — timetable tables only.
  const prune = async (table: string, column: string, current: string[]) => {
    const { data, error } = await db.from(table as never).select(column);
    if (error) throw new Error(error.message);
    const stored = ((data ?? []) as Record<string, string>[]).map((r) => r[column]);
    const stale = staleSourceIds(stored, current);
    if (stale.length > 0) {
      const { error: delErr } = await db
        .from(table as never)
        .delete()
        .in(column, stale);
      if (delErr) throw new Error(delErr.message);
    }
    return stale.length;
  };

  // Slots first: they reference classes and instructors.
  const removedSlots = await prune(
    "dmc_timetable_slots",
    "source_slot_id",
    snapshot.slots.map((s) => s.sourceSlotId),
  );
  await prune(
    "dmc_classes",
    "source_class_id",
    snapshot.classes.map((c) => c.sourceClassId),
  );
  await prune(
    "dmc_instructors",
    "source_instructor_id",
    snapshot.instructors.map((i) => i.sourceInstructorId),
  );

  const { error: metaErr } = await db.from("app_settings").upsert(
    {
      key: TIMETABLE_META_KEY,
      value: {
        last_refreshed_at: snapshot.fetchedAt,
        slots: snapshot.slots.length,
        classes: snapshot.classes.length,
        instructors: snapshot.instructors.length,
      },
    },
    { onConflict: "key" },
  );
  if (metaErr) throw new Error(metaErr.message);

  return {
    classes: snapshot.classes.length,
    instructors: snapshot.instructors.length,
    slots: snapshot.slots.length,
    removedSlots,
  };
}

/**
 * Timetable data for Google validation (Operation 6). Read once per sync — a
 * fixed three queries, never one per event — and never from the DMC API.
 * Suspended slots are included so a suspended class is reported as suspended
 * rather than silently unknown.
 */
export async function loadTimetableForMatching(): Promise<{
  slots: DmcTimetableSlot[];
  classes: DmcClassDefinition[];
  instructors: DmcInstructorDefinition[];
}> {
  const { classes, instructors, slots } = await loadStoredTimetable();
  return { classes, instructors, slots };
}

/** Read the stored timetable back in domain shape. */
export async function loadStoredTimetable(): Promise<StoredTimetable> {
  const db = await admin();
  const [classesRes, instructorsRes, slotsRes, metaRes] = await Promise.all([
    db.from("dmc_classes").select("*"),
    db.from("dmc_instructors").select("*"),
    db.from("dmc_timetable_slots").select("*").order("day_local").order("start_time_local"),
    db.from("app_settings").select("value").eq("key", TIMETABLE_META_KEY).maybeSingle(),
  ]);
  for (const res of [classesRes, instructorsRes, slotsRes, metaRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const classes = ((classesRes.data ?? []) as ClassRow[]).map((r) => ({
    sourceClassId: r.source_class_id,
    className: r.class_name,
    category: r.category,
    level: r.level,
    description: r.description,
    trailerId: r.trailer_id,
  }));
  const instructors = ((instructorsRes.data ?? []) as InstructorRow[]).map((r) => ({
    sourceInstructorId: r.source_instructor_id,
    firstName: r.first_name,
    lastName: r.last_name,
    title: r.title,
    bioInfo: r.bio_info,
    imageUrl: r.image_url,
  }));
  const slots = ((slotsRes.data ?? []) as SlotRow[]).map((r) => ({
    sourceSlotId: r.source_slot_id,
    sourceClassId: r.source_class_id,
    sourceInstructorId: r.source_instructor_id,
    dayLocal: r.day_local as DmcTimetableSlot["dayLocal"],
    scheduleKey: r.schedule_key,
    startTimeLocal: r.start_time_local,
    durationMinutes: r.duration_minutes,
    active: r.active,
    resumesOn: r.resumes_on,
  }));

  const meta = (metaRes.data?.value ?? null) as { last_refreshed_at?: string } | null;
  return {
    classes,
    instructors,
    slots,
    lastRefreshedAt: meta?.last_refreshed_at ?? null,
  };
}
