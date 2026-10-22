import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ session: {} as Record<string, unknown>, deletedId: "", error: null as unknown, touched: false }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate = (data: unknown) => data;
  const chain = { inputValidator: (fn: typeof validate) => { validate = fn; return chain; }, handler: (fn: (args: { data: unknown }) => unknown) => (args: { data: unknown }) => fn({ data: validate(args.data) }) };
  return chain;
} }));
vi.mock("@tanstack/react-start/server", () => ({ useSession: async () => ({ data: mock.session }) }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { mock.touched = true; return { delete: () => ({ eq: async (_key: string, value: string) => { mock.deletedId = value; return { error: mock.error }; } }) }; } } }));
import { deleteClassTimecode } from "./timecode.functions";

beforeEach(() => { vi.stubEnv("SESSION_SECRET", "test-only-session-secret"); mock.session = { siteUnlocked: true, username: "Shad" }; mock.deletedId = ""; mock.error = null; mock.touched = false; });
it("deletes only the requested timecode", async () => {
  await expect(deleteClassTimecode({ data: { classId: "obsolete-class" } })).resolves.toEqual({ ok: true });
  expect(mock.deletedId).toBe("obsolete-class");
});
it("does not delete for a locked visitor", async () => {
  mock.session = {};
  await expect(deleteClassTimecode({ data: { classId: "obsolete-class" } })).rejects.toMatchObject({ status: 401 });
  expect(mock.touched).toBe(false);
});
it("does not delete without an operator identity", async () => {
  mock.session = { siteUnlocked: true };
  await expect(deleteClassTimecode({ data: { classId: "obsolete-class" } })).rejects.toMatchObject({ status: 403 });
  expect(mock.touched).toBe(false);
});
it("keeps the operator-only deletion boundary for administrators", async () => {
  mock.session = { siteUnlocked: true, username: "Admin", isAdmin: true };
  await expect(deleteClassTimecode({ data: { classId: "obsolete-class" } })).rejects.toMatchObject({ status: 403 });
  expect(mock.touched).toBe(false);
});
it("reports a failed delete rather than claiming success", async () => {
  mock.error = { message: "unavailable" };
  await expect(deleteClassTimecode({ data: { classId: "obsolete-class" } })).rejects.toThrow("Could not delete timecode");
});