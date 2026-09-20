import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoricalChecklistItems, ChecklistRecords } from "@/components/admin/ChecklistRecords";
import { recordState, visibleChecklistRecords } from "@/components/admin/checklist-records-view";
import {
  checklistDateBounds,
  completionLabel,
  filterChecklistRecords,
  type ChecklistRecord,
} from "./checklist-records";
import {
  buildShiftChecklists,
  setChecklistItemState,
  ensureShiftChecklists,
} from "@/domain/checklists";
import { DEFAULT_CHECKLISTS } from "@/domain/checklist-templates";
import { berlinClock } from "./push-time";
const state = vi.hoisted(() => ({
  session: {} as { siteUnlocked?: boolean; username?: string; isAdmin?: boolean },
  rows: [] as unknown[],
  calls: [] as unknown[],
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ inputValidator: () => ({ handler: (fn: unknown) => fn }) }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  useSession: async () => ({ data: state.session }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      state.calls.push("from");
      const query = {
        select: () => query,
        gte: (...args: unknown[]) => {
          state.calls.push(args);
          return query;
        },
        lt: (...args: unknown[]) => {
          state.calls.push(args);
          return query;
        },
        order: async () => ({ data: state.rows, error: null }),
      };
      return query;
    },
  },
}));
import { adminListChecklistRecords } from "./checklist-records.functions";
const invoke = adminListChecklistRecords as unknown as (args: {
  data: { date: string };
}) => Promise<ChecklistRecord[]>;
const snapshot = () =>
  buildShiftChecklists(DEFAULT_CHECKLISTS, [
    {
      classId: "class",
      className: "Original Ballet",
      teacherName: "Teacher",
      startTime: "23:30",
      endTime: "00:30",
      durationMinutes: 60,
      status: "cancelled",
    },
  ]);
const row = (operator: string): ChecklistRecord => ({
  id: operator,
  operator_name: operator,
  check_in_at: "2026-09-20T16:30:00Z",
  check_out_at: null,
  checklists: snapshot(),
});
beforeEach(() => {
  state.calls = [];
  state.rows = [row("A"), row("B")];
  state.session = { siteUnlocked: true, username: "admin", isAdmin: true };
  process.env.SESSION_SECRET = "test-only-secret";
});
describe("admin historical reads", () => {
  it("allows admins and returns snapshots for both operators in one query", async () => {
    const rows = await invoke({ data: { date: "2026-09-20" } });
    expect(rows).toHaveLength(2);
    expect(state.calls).toEqual([
      "from",
      ["check_in_at", "2026-09-19T22:00:00.000Z"],
      ["check_in_at", "2026-09-20T22:00:00.000Z"],
    ]);
  });
  it.each([
    {},
    { siteUnlocked: true, username: "A", isAdmin: false },
    { siteUnlocked: false, username: "admin", isAdmin: true },
  ])("rejects non-admin direct access before any database read", async (session) => {
    state.session = session;
    await expect(invoke({ data: { date: "2026-09-20" } })).rejects.toMatchObject({ status: 403 });
    expect(state.calls).toEqual([]);
  });
  it("filters operators exactly", () => {
    expect(filterChecklistRecords([row("A"), row("B")], "A").map((r) => r.operator_name)).toEqual([
      "A",
    ]);
  });
  it("never fabricates old missing snapshots", async () => {
    state.rows = [{ ...row("A"), checklists: null }];
    expect((await invoke({ data: { date: "2026-09-20" } }))[0].checklists).toBeNull();
  });
  it("retains historical template wording, cancellation and completion", async () => {
    const old = snapshot();
    const edited = structuredClone(DEFAULT_CHECKLISTS);
    edited.ballet.items[0].text = "NEW TEMPLATE";
    state.rows = [{ ...row("A"), checklists: ensureShiftChecklists(old, edited) }];
    const rows = await invoke({ data: { date: "2026-09-20" } });
    expect(rows[0].checklists?.classes[0].items[0].text).toBe(
      DEFAULT_CHECKLISTS.ballet.items[0].text,
    );
    expect(rows[0].checklists?.classes[0].status).toBe("cancelled");
  });
});
describe("Berlin completion times", () => {
  it("checks, unchecks and rechecks without preserving a former time", () => {
    let value = snapshot();
    value = setChecklistItemState(
      value,
      { section: "start" },
      "start_01",
      true,
      berlinClock(new Date("2026-09-20T16:42:00Z")),
    );
    expect(value.start.items[0].completedAt).toBe("18:42");
    value = setChecklistItemState(value, { section: "start" }, "start_01", false, "18:43");
    expect(value.start.items[0].completedAt).toBeNull();
    value = setChecklistItemState(value, { section: "start" }, "start_01", true, "18:45");
    expect(value.start.items[0].completedAt).toBe("18:45");
  });
  it("uses Berlin summer and winter time", () => {
    expect(berlinClock(new Date("2026-01-20T08:05Z"))).toBe("09:05");
    expect(berlinClock(new Date("2026-09-20T21:17Z"))).toBe("23:17");
  });
  it.each([
    ["2026-03-29", 23],
    ["2026-10-25", 25],
  ])("handles DST date boundaries %s", (date, hours) => {
    const bounds = checklistDateBounds(String(date));
    expect((Date.parse(bounds.to) - Date.parse(bounds.from)) / 3600000).toBe(hours);
  });
  it("displays legacy and unchecked states without invented times", () => {
    expect(completionLabel({ id: "x", text: "task", completed: true })).toBe("Time not recorded");
    expect(completionLabel({ id: "x", text: "task", completed: false, completedAt: "18:42" })).toBe(
      "Not completed",
    );
  });
  it("renders historical task times without editable inputs", () => {
    const html = renderToStaticMarkup(
      <HistoricalChecklistItems
        headings
        items={[
          {
            id: "a",
            text: "Original task",
            heading: "Class Starts",
            completed: true,
            completedAt: "18:42",
          },
          { id: "b", text: "Unchecked", completed: false, completedAt: "19:59" },
          { id: "c", text: "Old task", completed: true },
        ]}
      />,
    );
    expect(html).toContain("18:42");
    expect(html).not.toContain("19:59");
    expect(html).toContain("Time not recorded");
    expect(html).toContain("Not completed");
    expect(html).not.toContain("<input");
  });
  it("renders actual shift timing and operator", () => {
    const completed = row("Shad");
    completed.checklists = setChecklistItemState(
      completed.checklists!,
      { section: "start" },
      "start_01",
      true,
      "18:31",
    );
    const html = renderToStaticMarkup(<ChecklistRecords records={[completed]} />);
    expect(html).toContain("Shad");
    expect(html).toContain("18:30");
    expect(html).toContain("20 September 2026");
    expect(html).toContain("Shift Timing");
    expect(html).toContain("Status");
    expect(html).toContain("In Progress");
  });
  it("shows only shifts with activity, newest first", () => {
    const older = row("Older");
    older.check_in_at = "2026-09-19T10:00:00Z";
    older.checklists = setChecklistItemState(
      older.checklists!,
      { section: "start" },
      "start_01",
      true,
      "12:01",
    );
    const newer = row("Newer");
    newer.check_in_at = "2026-09-20T10:00:00Z";
    newer.checklists = setChecklistItemState(
      newer.checklists!,
      { section: "end" },
      "end_01",
      true,
      "12:02",
    );
    const empty = row("Empty");
    expect(
      visibleChecklistRecords([older, empty, newer]).map((record) => record.operator_name),
    ).toEqual(["Newer", "Older"]);
    expect(recordState(empty)).toBe("not-started");
    expect(recordState(newer)).toBe("in-progress");
  });
});
