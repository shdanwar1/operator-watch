import { describe, expect, it } from "vitest";
import {
  classifyClassRow,
  classifyClassRows,
  retentionCutoff,
  type RetentionContext,
} from "./class-retention";

const TODAY = "2026-09-10";

function ctx(over: Partial<RetentionContext> = {}): RetentionContext {
  return {
    today: TODAY,
    knownShiftIds: new Set<string>(),
    recordsByShiftId: new Map(),
    ...over,
  };
}

const row = (specificDate: string, scheduledShiftId: string | null = null) => ({
  id: `${specificDate}-${scheduledShiftId ?? "none"}`,
  specificDate,
  scheduledShiftId,
});

describe("calendar_classes retention", () => {
  it("keeps a grace window of two days", () => {
    expect(retentionCutoff(TODAY)).toBe("2026-09-08");
  });

  it("keeps future classes", () => {
    expect(classifyClassRow(row("2026-09-30"), ctx())).toMatchObject({
      decision: "keep",
      reason: "future-or-today",
    });
  });

  it("keeps today's classes", () => {
    expect(classifyClassRow(row(TODAY), ctx())).toMatchObject({
      decision: "keep",
      reason: "future-or-today",
    });
  });

  it("keeps yesterday and the two-day-old day", () => {
    expect(classifyClassRow(row("2026-09-09"), ctx()).decision).toBe("keep");
    expect(classifyClassRow(row("2026-09-08"), ctx())).toMatchObject({
      decision: "keep",
      reason: "grace-window",
    });
  });

  it("deletes an old detached row", () => {
    expect(classifyClassRow(row("2026-09-01"), ctx())).toMatchObject({
      decision: "delete",
      reason: "obsolete",
    });
  });

  it("keeps an old row whose shift cannot be resolved", () => {
    expect(classifyClassRow(row("2026-09-01", "s1"), ctx())).toMatchObject({
      decision: "keep",
      reason: "unresolved",
    });
  });

  it("keeps an old row on a shift with no Record", () => {
    const c = ctx({ knownShiftIds: new Set(["s1"]) });
    expect(classifyClassRow(row("2026-09-01", "s1"), c)).toMatchObject({
      decision: "keep",
      reason: "shift-incomplete",
    });
  });

  it("keeps an old row whose Record is not checked out", () => {
    const c = ctx({
      knownShiftIds: new Set(["s1"]),
      recordsByShiftId: new Map([["s1", { checkedOut: false, snapshotCount: 3 }]]),
    });
    expect(classifyClassRow(row("2026-09-01", "s1"), c)).toMatchObject({
      decision: "keep",
      reason: "shift-incomplete",
    });
  });

  it("keeps an old row whose Record snapshot is empty", () => {
    const c = ctx({
      knownShiftIds: new Set(["s1"]),
      recordsByShiftId: new Map([["s1", { checkedOut: true, snapshotCount: 0 }]]),
    });
    expect(classifyClassRow(row("2026-09-01", "s1"), c)).toMatchObject({
      decision: "keep",
      reason: "record-snapshot-empty",
    });
  });

  it("deletes an old row already captured in a completed Record", () => {
    const c = ctx({
      knownShiftIds: new Set(["s1"]),
      recordsByShiftId: new Map([["s1", { checkedOut: true, snapshotCount: 2 }]]),
    });
    expect(classifyClassRow(row("2026-09-01", "s1"), c)).toMatchObject({
      decision: "delete",
      reason: "obsolete",
    });
  });

  it("summarises a mixed set", () => {
    const c = ctx({
      knownShiftIds: new Set(["s1"]),
      recordsByShiftId: new Map([["s1", { checkedOut: true, snapshotCount: 1 }]]),
    });
    const report = classifyClassRows(
      [row("2026-09-20"), row(TODAY), row("2026-09-09"), row("2026-08-01"), row("2026-08-02", "s1"), row("2026-08-03", "s2")],
      c,
    );
    expect(report.total).toBe(6);
    expect(report.deletableIds).toHaveLength(2);
    expect(report.keptByReason["future-or-today"]).toBe(2);
    expect(report.keptByReason["grace-window"]).toBe(1);
    expect(report.keptByReason.unresolved).toBe(1);
  });
});
