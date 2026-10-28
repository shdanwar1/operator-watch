import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ calls: [] as unknown[], fail: false }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: (_name: string, args: unknown) => {
  state.calls.push(args);
  return { abortSignal: async () => { if (state.fail) throw new Error("private diagnostic"); return { error: null }; } };
} } }));
import { recordAutomationHealth } from "./automation-health.server";
beforeEach(() => { state.calls = []; state.fail = false; });
it("records a no-op outcome and concrete counters", async () => {
  await recordAutomationHealth("auto_checkout", Date.now(), { outcome: "noop", counters: { closed: 0 }, stages: {}, errorCode: null });
  expect(state.calls[0]).toMatchObject({ p_process: "auto_checkout", p_outcome: "noop", p_counters: { closed: 0 }, p_error_code: "" });
});
it("telemetry failure never rejects the business caller", async () => {
  state.fail = true;
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(recordAutomationHealth("auto_checkout", Date.now(), { outcome: "failed", counters: {}, stages: {}, errorCode: "checkout_failed" })).resolves.toBeUndefined();
  expect(spy).toHaveBeenCalledWith("Automation health unavailable", "auto_checkout");
  spy.mockRestore();
});