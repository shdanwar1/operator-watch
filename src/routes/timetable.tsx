import { createFileRoute, redirect } from "@tanstack/react-router";
import { getGateStatus } from "@/lib/gate.functions";

/**
 * The Timetable is an Admin-only page. Operators are sent back to their
 * dashboard; admins land on the Admin Timetable.
 */
export const Route = createFileRoute("/timetable")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin/timetable" });
    throw redirect({ to: "/" });
  },
});
