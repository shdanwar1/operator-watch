import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ readError: false, closeFails: false, closeResult: true, reports: [] as Record<string, unknown>[] }));
vi.mock("@/lib/automation-health.server", () => ({ recordAutomationHealth: async (_p: string, _t: number, report: Record<string, unknown>) => state.reports.push(structuredClone(report)) }));
vi.mock("./shift-close.server", () => ({ closeShift: async () => { if (state.closeFails) throw new Error("close failed"); return state.closeResult; } }));
vi.mock("@/domain/auto-checkout", () => ({ AUTO_CHECKOUT_WINDOW_MS: 300000, scheduledEndAt: () => new Date("2026-10-28T08:00:00Z"), autoCheckoutAt: () => new Date("2026-10-28T08:00:00Z") }));
vi.mock("@/domain/checklists", () => ({ isShiftChecklists: () => false }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => {
  const chain = { select: () => chain, is: () => chain, eq: () => chain, in: async () => ({ data: [{ id: "worked", scheduled_shift_id: "scheduled", check_in_at: "2026-10-28T07:00:00Z", checklists: {}, classes: [] }], error: state.readError ? { message: "read failed" } : null }) };
  return chain;
} } }));
import { runAutoCheckout } from "./auto-checkout.server";
const now = new Date("2026-10-28T08:00:01Z");
const schedule = [{ id: "scheduled", specific_date: "2026-10-28", start_time: "08:00", end_time: "09:00", status: "scheduled" }];
beforeEach(() => { state.readError = false; state.closeFails = false; state.closeResult = true; state.reports = []; vi.spyOn(console, "error").mockImplementation(() => {}); });
it("empty successful scan remains a no-op", async () => {
  expect(await runAutoCheckout(now, [])).toBe(0);
  expect(state.reports[0]).toMatchObject({ outcome: "noop", counters: { closed: 0, failed: 0 } });
});
it("a failed open-shift read is not reported as successful inactivity", async () => {
  state.readError = true;
  expect(await runAutoCheckout(now, schedule)).toBe(0);
  expect(state.reports[0]).toMatchObject({ outcome: "failed", errorCode: "open_shift_read_failed" });
});
it("a closure error is retained in the aggregate report", async () => {
  state.closeFails = true;
  expect(await runAutoCheckout(now, schedule)).toBe(0);
  expect(state.reports[0]).toMatchObject({ outcome: "partial", errorCode: "checkout_failed", counters: { failed: 1 } });
});
it("successful closure records one closed shift", async () => {
  expect(await runAutoCheckout(now, schedule)).toBe(1);
  expect(state.reports[0]).toMatchObject({ outcome: "success", counters: { closed: 1 } });
});
it("an overlapping closure no-op is counted, not mislabeled as a database failure", async () => {
  state.closeResult = false;
  expect(await runAutoCheckout(now, schedule)).toBe(0);
  expect(state.reports[0]).toMatchObject({ outcome: "noop", counters: { already_closed: 1, failed: 0 } });
});