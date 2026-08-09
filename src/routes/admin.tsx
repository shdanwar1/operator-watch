import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { getGateStatus } from "@/lib/gate.functions";

/**
 * Admin application layout. Every /admin/* route is gated here: only an
 * authenticated admin gets in, and admins always stay inside this shell.
 */
export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (!status.isAdmin) throw redirect({ to: "/" });
    return { username: status.username ?? "admin" };
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <AdminShell>
      <Outlet />
      <Toaster position="top-center" />
    </AdminShell>
  );
}
