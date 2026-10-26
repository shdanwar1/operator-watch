import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ session: {} as Record<string, unknown>, touched: false }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate = (data: unknown) => data;
  const chain = { inputValidator: (fn: typeof validate) => { validate = fn; return chain; }, handler: (fn: (args: { data: unknown }) => unknown) => (args?: { data: unknown }) => fn({ data: validate(args?.data) }) };
  return chain;
} }));
vi.mock("@tanstack/react-start/server", () => ({ useSession: async () => ({ data: mock.session }) }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { mock.touched = true; throw new Error("Unexpected database access"); } } }));
vi.mock("@/domain/shift-generation.server", () => ({ readRotationAdjustments: async () => { mock.touched = true; return []; } }));
import { adminAddRotationAdjustment, adminListRotationAdjustments, adminRemoveRotationAdjustment } from "./rotation.functions";
beforeEach(() => { vi.stubEnv("SESSION_SECRET", "test-only-session-secret"); mock.session = {}; mock.touched = false; });
const addData = { operator: "Alex", validFrom: "2026-11-01T00:00", validUntil: "2026-12-01T00:00" };
describe("adjustment admin gate", () => {
  it.each([{}, { siteUnlocked: true, username: "Shad" }, { isAdmin: true }])("rejects list, add and removal before database access: %j", async (session) => {
    mock.session = session;
    await expect(adminListRotationAdjustments()).rejects.toMatchObject({ status: 403 });
    await expect(adminAddRotationAdjustment({ data: addData })).rejects.toMatchObject({ status: 403 });
    await expect(adminRemoveRotationAdjustment({ data: { id: "11a20260-0000-4000-8000-000000000001" } })).rejects.toMatchObject({ status: 403 });
    expect(mock.touched).toBe(false);
  });
  it("allows an unlocked administrator to list", async () => {
    mock.session = { siteUnlocked: true, isAdmin: true };
    await expect(adminListRotationAdjustments()).resolves.toEqual([]);
    expect(mock.touched).toBe(true);
  });
});