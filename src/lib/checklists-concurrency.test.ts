import { beforeEach, expect, it, vi } from "vitest";
import { buildShiftChecklists, setChecklistItemState } from "@/domain/checklists";
import { DEFAULT_CHECKLISTS } from "@/domain/checklist-templates";

const store = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  calls: 0,
  failNext: new Set<string>(),
  delay: (_itemId: string) => 0,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        in: () => query,
        maybeSingle: async () => ({ data: structuredClone(store.row), error: null }),
      };
      return query;
    },
    // Mirrors set_shift_checklist_item: one atomic, row-locked item write.
    rpc: async (_name: string, args: Record<string, unknown>) => {
      store.calls++;
      const itemId = String(args['p_item_id']);
      await new Promise((r) => setTimeout(r, store.delay(itemId)));
      if (store.failNext.has(itemId)) {
        store.failNext.delete(itemId);
        return { data: null, error: { message: "Bad Request" } };
      }
      const operator = String(args['p_operator'] ?? "");
      if (
        String(store.row['operator_name']).trim().toLowerCase() !== operator.trim().toLowerCase()
      ) {
        return { data: null, error: { message: "FORBIDDEN" } };
      }
      if (store.row['check_out_at']) return { data: null, error: { message: "SHIFT_CLOSED" } };
      const section = String(args['p_section']) as "start" | "end" | "class";
      const target =
        section === "class"
          ? ({ section: "class", classId: String(args['p_class_id']) } as const)
          : ({ section } as const);
      const next = setChecklistItemState(
        store.row['checklists'] as ReturnType<typeof buildShiftChecklists>,
        target,
        itemId,
        Boolean(args['p_completed']),
        (args['p_completed_at'] as string | null) ?? null,
      );
      store.row = { ...store.row, checklists: next };
      return { data: structuredClone(next), error: null };
    },
  },
}));

import { setChecklistItem } from "./checklists.server";

const base = { shiftId: "shift", operator: "A", section: "start" as const };
const snapshot = () => store.row['checklists'] as ReturnType<typeof buildShiftChecklists>;
const item = (id: string) => snapshot().start.items.find((i) => i.id === id)!;

beforeEach(async () => {
  await import("@/integrations/supabase/client.server");
  store.calls = 0;
  store.failNext = new Set();
  store.delay = () => 0;
  store.row = {
    id: "shift",
    operator_name: "A",
    check_out_at: null,
    scheduled_shift_id: null,
    checklists: buildShiftChecklists(DEFAULT_CHECKLISTS),
  };
});

it("persists five overlapping item writes", async () => {
  const ids = ["start_01", "start_02", "start_03", "start_04", "start_05"];
  await Promise.all(ids.map((itemId) => setChecklistItem({ ...base, itemId, completed: true })));
  for (const id of ids) {
    expect(item(id).completed).toBe(true);
    expect(item(id).completedAt).toMatch(/^\d{2}:\d{2}$/);
  }
});

it("keeps every item when responses resolve out of order", async () => {
  const ids = ["start_01", "start_02", "start_03"];
  store.delay = (itemId) => (itemId === "start_01" ? 20 : itemId === "start_02" ? 10 : 0);
  await Promise.all(ids.map((itemId) => setChecklistItem({ ...base, itemId, completed: true })));
  expect(ids.every((id) => item(id).completed)).toBe(true);
});

it("leaves neighbours intact when one write fails", async () => {
  store.failNext.add("start_02");
  await setChecklistItem({ ...base, itemId: "start_01", completed: true });
  await expect(setChecklistItem({ ...base, itemId: "start_02", completed: true })).rejects.toThrow();
  await setChecklistItem({ ...base, itemId: "start_03", completed: true });
  expect(item("start_01").completed).toBe(true);
  expect(item("start_02").completed).toBe(false);
  expect(item("start_03").completed).toBe(true);
  // Retrying the failed change still works — nothing is stuck.
  await setChecklistItem({ ...base, itemId: "start_02", completed: true });
  expect(item("start_02").completed).toBe(true);
});

it("ends a check/uncheck/recheck sequence checked with a fresh time", async () => {
  await setChecklistItem({ ...base, itemId: "start_01", completed: true });
  await setChecklistItem({ ...base, itemId: "start_01", completed: false });
  expect(item("start_01").completedAt).toBeNull();
  await setChecklistItem({ ...base, itemId: "start_01", completed: true });
  expect(item("start_01").completed).toBe(true);
  expect(item("start_01").completedAt).toMatch(/^\d{2}:\d{2}$/);
});

it("keeps sections and classes independent", async () => {
  const classes = ["c1", "c2"];
  store.row['checklists'] = buildShiftChecklists(DEFAULT_CHECKLISTS, [
    {
      classId: "c1",
      className: "A",
      teacherName: "T",
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
    },
    {
      classId: "c2",
      className: "B",
      teacherName: "T",
      startTime: "12:00",
      endTime: "12:45",
      durationMinutes: 45,
    },
  ]);
  await Promise.all([
    setChecklistItem({ ...base, itemId: "start_01", completed: true }),
    setChecklistItem({ ...base, section: "end", itemId: "end_01", completed: true }),
    setChecklistItem({
      ...base,
      section: "class",
      classId: "c1",
      itemId: snapshot().classes[0].items[0].id,
      completed: true,
    }),
    setChecklistItem({
      ...base,
      section: "class",
      classId: "c2",
      itemId: snapshot().classes[1].items[0].id,
      completed: true,
    }),
  ]);
  const final = snapshot();
  expect(final.start.items[0].completed).toBe(true);
  expect(final.end.items[0].completed).toBe(true);
  expect(final.classes.map((c) => c.items[0].completed)).toEqual([true, true]);
  expect(final.classes.every((c) => c.items.slice(1).every((i) => !i.completed))).toBe(true);
  expect(classes.length).toBe(2);
});

it("rejects another operator and closed shifts", async () => {
  const input = { ...base, itemId: "start_01", completed: true };
  await expect(setChecklistItem({ ...input, operator: "B" })).rejects.toMatchObject({ status: 403 });
  store.row['check_out_at'] = "2026-09-20T20:00Z";
  await expect(setChecklistItem(input)).rejects.toMatchObject({ status: 409 });
});
