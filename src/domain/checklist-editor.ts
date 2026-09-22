/**
 * Master checklist editing (Operation 4) — pure, no database.
 *
 * Draft operations plus the validation shared by the admin UI and the admin
 * server function. The model stays flat: one ordered `items` array where each
 * item may carry a display-only `heading` (Ballet / Workout only).
 */
import type { ChecklistTemplate, ChecklistTemplateItem, ChecklistType } from "./checklists";

export const CHECKLIST_TYPES: ChecklistType[] = ["start_shift", "ballet", "workout", "end_shift"];

/** Only these two kinds may carry headings. */
export function supportsHeadings(type: ChecklistType): boolean {
  return type === "ballet" || type === "workout";
}

export const CLASS_HEADINGS = [
  "10 Minutes Before Class",
  "5 Minutes Before Class",
  "Class Starts",
  "During the Class",
  "End of Class",
  "After the Class",
] as const;

export const MAX_ITEM_TEXT = 300;
export const MAX_ITEMS = 200;

export function isChecklistType(value: unknown): value is ChecklistType {
  return typeof value === "string" && (CHECKLIST_TYPES as string[]).includes(value);
}

/** Stable unique id for a newly added item. */
export function newItemId(type: ChecklistType, existing: ChecklistTemplateItem[]): string {
  const prefix = `${type}_new`;
  const taken = new Set(existing.map((i) => i.id));
  let n = 1;
  let id = `${prefix}_${n}`;
  while (taken.has(id)) {
    n += 1;
    id = `${prefix}_${n}`;
  }
  return id;
}

export function moveItem(
  items: ChecklistTemplateItem[],
  from: number,
  to: number,
): ChecklistTemplateItem[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return items;
  next.splice(to, 0, moved);
  return next;
}

export function moveItemUp(items: ChecklistTemplateItem[], index: number) {
  return moveItem(items, index, index - 1);
}

export function moveItemDown(items: ChecklistTemplateItem[], index: number) {
  return moveItem(items, index, index + 1);
}

export function updateItem(
  items: ChecklistTemplateItem[],
  id: string,
  patch: { text?: string; heading?: string | null },
): ChecklistTemplateItem[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    const next: ChecklistTemplateItem = { ...item };
    if (patch.text !== undefined) next.text = patch.text;
    if (patch.heading !== undefined) {
      if (patch.heading) next.heading = patch.heading;
      else delete next.heading;
    }
    return next;
  });
}

export function addItem(
  type: ChecklistType,
  items: ChecklistTemplateItem[],
  input: { text: string; heading?: string | null },
): ChecklistTemplateItem[] {
  const item: ChecklistTemplateItem = { id: newItemId(type, items), text: input.text };
  if (supportsHeadings(type) && input.heading) item.heading = input.heading;
  return [...items, item];
}

export function deleteItem(items: ChecklistTemplateItem[], id: string): ChecklistTemplateItem[] {
  return items.filter((i) => i.id !== id);
}

/**
 * Server-grade validation. Throws on anything malformed; returns the
 * normalised template (ordering preserved, headings stripped where they are
 * not allowed).
 */
export function validateChecklistTemplate(
  type: unknown,
  input: { title?: unknown; items?: unknown },
): { type: ChecklistType; template: ChecklistTemplate } {
  if (!isChecklistType(type)) throw new Error("Invalid checklist type");
  const title = String(input?.title ?? "").trim();
  if (!title) throw new Error("Checklist title is required");
  if (title.length > 120) throw new Error("Checklist title is too long");
  if (!Array.isArray(input?.items)) throw new Error("Checklist items must be a list");
  const raw = input.items as unknown[];
  if (raw.length > MAX_ITEMS) throw new Error("Too many checklist items");

  const seen = new Set<string>();
  const items: ChecklistTemplateItem[] = raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Item ${index + 1} is malformed`);
    const e = entry as { id?: unknown; text?: unknown; heading?: unknown };
    const id = String(e.id ?? "").trim();
    if (!id) throw new Error(`Item ${index + 1} is missing an id`);
    if (id.length > 64) throw new Error(`Item ${index + 1} has an invalid id`);
    if (seen.has(id)) throw new Error(`Duplicate checklist item id: ${id}`);
    seen.add(id);
    const text = String(e.text ?? "").trim();
    if (!text) throw new Error(`Item ${index + 1} needs some text`);
    if (text.length > MAX_ITEM_TEXT) throw new Error(`Item ${index + 1} is too long`);
    const item: ChecklistTemplateItem = { id, text };
    const heading = e.heading === undefined || e.heading === null ? "" : String(e.heading).trim();
    if (heading) {
      if (!supportsHeadings(type)) {
        throw new Error("This checklist does not support headings");
      }
      if (heading.length > 120) throw new Error(`Item ${index + 1} has an invalid heading`);
      item.heading = heading;
    }
    return item;
  });

  return { type, template: { title, items } };
}
