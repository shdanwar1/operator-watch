import { beforeEach, expect, it, vi } from "vitest";
import { buildShiftChecklists } from "@/domain/checklists";
import { DEFAULT_CHECKLISTS } from "@/domain/checklist-templates";
const store = vi.hoisted(() => ({ row: {} as Record<string, unknown>, conflicts: 0 }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      let update: Record<string, unknown> | undefined;
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        is: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        update: (value: Record<string, unknown>) => {
          update = value;
          return query;
        },
        maybeSingle: async () => ({ data: structuredClone(store.row), error: null }),
        then: (resolve: (value: unknown) => unknown) => {
          const matches = filters.every(([key, value]) =>
            key === "checklists" && typeof value === "string"
              ? JSON.stringify(store.row[key]) === value
              : store.row[key] === value,
          );
          if (matches && update) store.row = { ...store.row, ...structuredClone(update) };
          else store.conflicts++;
          return Promise.resolve(
            resolve({ data: matches ? [{ id: store.row.id }] : [], error: null }),
          );
        },
      };
      return query;
    },
  },
}));
import { setChecklistItem } from "./checklists.server";
beforeEach(() => {
  store.conflicts = 0;
  store.row = {
    id: "shift",
    operator_name: "A",
    check_out_at: null,
    scheduled_shift_id: null,
    checklists: buildShiftChecklists(DEFAULT_CHECKLISTS),
  };
});
it("retries competing writes without losing either item or its time", async () => {
  const input = { shiftId: "shift", operator: "A", section: "start" as const, completed: true };
  await Promise.all([
    setChecklistItem({ ...input, itemId: "start_01" }),
    setChecklistItem({ ...input, itemId: "start_02" }),
  ]);
  const snapshot = store.row.checklists as ReturnType<typeof buildShiftChecklists>;
  expect(
    snapshot.start.items
      .slice(0, 2)
      .every((i) => i.completed && /^\d{2}:\d{2}$/.test(i.completedAt ?? "")),
  ).toBe(true);
  expect(store.conflicts).toBeGreaterThan(0);
});
it("rejects another operator and closed shifts", async () => {
  const input = {
    shiftId: "shift",
    operator: "B",
    section: "start" as const,
    itemId: "start_01",
    completed: true,
  };
  await expect(setChecklistItem(input)).rejects.toMatchObject({ status: 403 });
  store.row.check_out_at = "2026-09-20T20:00Z";
  await expect(setChecklistItem({ ...input, operator: "A" })).rejects.toMatchObject({
    status: 409,
  });
});
