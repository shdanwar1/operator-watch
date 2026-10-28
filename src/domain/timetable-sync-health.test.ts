import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fetchOk: true, commitFails: false, generationFails: false, reports: [] as { outcome: string; errorCode: string | null; stages: Record<string, string> }[] }));
vi.mock("./dmc-timetable-provider.server", () => ({ dmcPublicTimetableProvider: { fetchTimetable: async () => state.fetchOk ? { ok: true, snapshot: { fetchedAt: "2026-10-28T05:00:00Z" }, anomalies: [] } : { ok: false, error: "unavailable" } } }));
vi.mock("./timetable-repository.server", () => ({ commitSnapshot: async () => { if (state.commitFails) throw new Error("commit"); return { slots: 8, removedSlots: 0 }; } }));
vi.mock("./shift-generation.server", () => ({ generateTimetableShifts: async () => { if (state.generationFails) throw new Error("generation"); return { shifts: 3 }; } }));
vi.mock("@/lib/automation-health.server", () => ({ recordAutomationHealth: async (_p: string, _t: number, report: typeof state.reports[number]) => state.reports.push(structuredClone(report)) }));
import { runTimetableSync } from "./timetable-sync.server";
beforeEach(() => { state.fetchOk = true; state.commitFails = false; state.generationFails = false; state.reports = []; });
it("records successful snapshot and generation separately", async () => {
  await expect(runTimetableSync()).resolves.toMatchObject({ ok: true });
  expect(state.reports[0]).toMatchObject({ outcome: "success", errorCode: null, stages: { snapshot: "saved", shift_generation: "completed" }, counters: { slots: 8, shifts: 3 } });
});
it("records fetch failure without changing the returned failure", async () => {
  state.fetchOk = false;
  await expect(runTimetableSync()).resolves.toEqual({ ok: false, error: "unavailable" });
  expect(state.reports[0]).toMatchObject({ outcome: "failed", errorCode: "fetch_failed" });
});
it("records partial success when generation fails after a saved snapshot", async () => {
  state.generationFails = true;
  await expect(runTimetableSync()).rejects.toThrow("generation");
  expect(state.reports[0]).toMatchObject({ outcome: "partial", errorCode: "generation_failed", stages: { snapshot: "saved", shift_generation: "not started" } });
});
it("preserves snapshot failure and reports it", async () => {
  state.commitFails = true;
  await expect(runTimetableSync()).rejects.toThrow("commit");
  expect(state.reports[0]).toMatchObject({ outcome: "failed", errorCode: "snapshot_failed" });
});