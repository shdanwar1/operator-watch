import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ session: {} as Record<string, unknown>, touched: false, error: false }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ handler: (fn: () => unknown) => fn }) }));
vi.mock("@tanstack/react-start/server", () => ({ useSession: async () => ({ data: mock.session }) }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: () => { mock.touched = true; return { select: async () => ({ data: [], error: mock.error ? {} : null }) }; },
  rpc: async () => ({ data: false, error: null }),
} }));
import { adminGetAutomationHealth } from "./automation-health.functions";
beforeEach(() => { vi.stubEnv("SESSION_SECRET", "test-only-secret"); mock.session = {}; mock.touched = false; mock.error = false; });
describe("automation admin boundary", () => {
  it.each([{}, { siteUnlocked: true, username: "Shad" }, { isAdmin: true }, { siteUnlocked: true, isAdmin: true }])("rejects incomplete or operator sessions before data access: %j", async session => {
    mock.session = session;
    await expect(adminGetAutomationHealth()).rejects.toMatchObject({ status: 403 });
    expect(mock.touched).toBe(false);
  });
  it("allows the fully signed-in administrator", async () => {
    mock.session = { siteUnlocked: true, isAdmin: true, username: "Admin" };
    const result = await adminGetAutomationHealth();
    expect(result.rows).toEqual([]);
    expect(result.dispatchDue).toBe(false);
    expect(mock.touched).toBe(true);
  });
  it("does not disguise a failed read as no results", async () => {
    mock.session = { siteUnlocked: true, isAdmin: true, username: "Admin" }; mock.error = true;
    await expect(adminGetAutomationHealth()).rejects.toThrow("Automation health unavailable");
  });
});