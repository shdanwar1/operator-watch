/**
 * Checklist domain logic (Operation 1) — pure, no database.
 *
 * Master templates live in `app_settings.operator_checklists`. When a real
 * shift is opened, the current templates are COPIED into
 * `shifts.checklists`: that snapshot is the historical record, so later
 * template edits never change a past shift.
 */

export type ChecklistType = "start_shift" | "ballet" | "workout" | "end_shift";

/** Ballet/Workout class checklist kinds — the only ones a class can have. */
export type ClassChecklistType = Extract<ChecklistType, "ballet" | "workout">;

export type ChecklistTemplateItem = {
  id: string;
  text: string;
  /** Display-only grouping label (Ballet / Workout only). */
  heading?: string;
};

export type ChecklistTemplate = {
  title: string;
  items: ChecklistTemplateItem[];
};

export type ChecklistConfig = Record<ChecklistType, ChecklistTemplate>;

export type ChecklistSnapshotItem = ChecklistTemplateItem & { completed: boolean };

export type ChecklistClassSnapshot = {
  classId: string;
  type: ClassChecklistType;
  className: string;
  teacherName: string;
  startTime: string;
  endTime: string;
  /** Mirrors the class row status ("scheduled" / "cancelled"). */
  status?: string;
  items: ChecklistSnapshotItem[];
};

export type ShiftChecklists = {
  start: { items: ChecklistSnapshotItem[] };
  classes: ChecklistClassSnapshot[];
  end: { items: ChecklistSnapshotItem[] };
};

/** Class metadata the snapshot is built from. Matches the live class row. */
export type ChecklistClassInput = {
  classId: string;
  className: string;
  teacherName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  status?: string;
};

export const WORKOUT_DURATION_MIN = 45;
export const BALLET_DURATION_MIN = 60;

/** 45 min → workout, 60 min → ballet, anything else → no checklist. */
export function checklistTypeForDuration(durationMinutes: number): ClassChecklistType | null {
  if (durationMinutes === WORKOUT_DURATION_MIN) return "workout";
  if (durationMinutes === BALLET_DURATION_MIN) return "ballet";
  return null;
}

function snapshotItems(template: ChecklistTemplate): ChecklistSnapshotItem[] {
  return template.items.map((i) => ({
    id: i.id,
    text: i.text,
    ...(i.heading ? { heading: i.heading } : {}),
    completed: false,
  }));
}

function classSnapshot(
  config: ChecklistConfig,
  input: ChecklistClassInput,
): ChecklistClassSnapshot | null {
  const type = checklistTypeForDuration(input.durationMinutes);
  if (!type) return null;
  return {
    classId: input.classId,
    type,
    className: input.className,
    teacherName: input.teacherName,
    startTime: input.startTime,
    endTime: input.endTime,
    ...(input.status ? { status: input.status } : {}),
    items: snapshotItems(config[type]),
  };
}

/** Fresh snapshot for a newly opened shift. */
export function buildShiftChecklists(
  config: ChecklistConfig,
  classes: ChecklistClassInput[] = [],
): ShiftChecklists {
  return {
    start: { items: snapshotItems(config.start_shift) },
    classes: classes
      .map((c) => classSnapshot(config, c))
      .filter((c): c is ChecklistClassSnapshot => c !== null),
    end: { items: snapshotItems(config.end_shift) },
  };
}

/** True when a stored value already is a usable snapshot. */
export function isShiftChecklists(value: unknown): value is ShiftChecklists {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ShiftChecklists>;
  return (
    !!v.start &&
    Array.isArray(v.start.items) &&
    !!v.end &&
    Array.isArray(v.end.items) &&
    Array.isArray(v.classes)
  );
}

/**
 * Idempotent: an existing snapshot is returned untouched (no reset of
 * completed items, no second snapshot).
 */
export function ensureShiftChecklists(
  existing: unknown,
  config: ChecklistConfig,
  classes: ChecklistClassInput[] = [],
): ShiftChecklists {
  if (isShiftChecklists(existing)) return existing;
  return buildShiftChecklists(config, classes);
}

/**
 * Brings the snapshot's class entries in line with the shift's live classes.
 *
 * - new class → snapshot added from the CURRENT template
 * - metadata change → metadata updated, completion preserved
 * - type change (45 ↔ 60) → items rebuilt from the correct template
 * - class removed → entry removed
 * - cancelled class → kept, with its status recorded
 */
export function syncClassChecklists(
  snapshot: ShiftChecklists,
  config: ChecklistConfig,
  classes: ChecklistClassInput[],
): ShiftChecklists {
  const byId = new Map(snapshot.classes.map((c) => [c.classId, c]));
  const next: ChecklistClassSnapshot[] = [];
  for (const input of classes) {
    const fresh = classSnapshot(config, input);
    if (!fresh) continue;
    const prev = byId.get(input.classId);
    if (!prev) {
      next.push(fresh);
      continue;
    }
    next.push(prev.type === fresh.type ? { ...fresh, items: prev.items } : fresh);
  }
  return { ...snapshot, classes: next };
}

/** Sets one item's completed flag. Unknown ids leave the snapshot unchanged. */
export function setChecklistItemState(
  snapshot: ShiftChecklists,
  target: { section: "start" } | { section: "end" } | { section: "class"; classId: string },
  itemId: string,
  completed: boolean,
): ShiftChecklists {
  const apply = (items: ChecklistSnapshotItem[]) =>
    items.map((i) => (i.id === itemId ? { ...i, completed } : i));

  if (target.section === "start") {
    return { ...snapshot, start: { items: apply(snapshot.start.items) } };
  }
  if (target.section === "end") {
    return { ...snapshot, end: { items: apply(snapshot.end.items) } };
  }
  const { classId } = target;
  return {
    ...snapshot,
    classes: snapshot.classes.map((c) =>
      c.classId === classId ? { ...c, items: apply(c.items) } : c,
    ),
  };
}

/** Derived progress for a list of snapshot items. Never stored. */
export function checklistProgress(items: ChecklistSnapshotItem[]): {
  completed: number;
  total: number;
  complete: boolean;
} {
  const total = items.length;
  const completed = items.filter((i) => i.completed).length;
  return { completed, total, complete: total > 0 && completed === total };
}

/** True when every End Shift item is ticked. An empty end list counts as done. */
export function isEndChecklistComplete(snapshot: unknown): boolean {
  if (!isShiftChecklists(snapshot)) return true;
  return snapshot.end.items.every((i) => i.completed);
}
