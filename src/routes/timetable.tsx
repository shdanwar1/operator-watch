import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { TimetableView } from "@/components/timetable/TimetableView";
import { getGateStatus } from "@/lib/gate.functions";
import { pageMeta } from "@/lib/page-titles";
export const Route = createFileRoute("/timetable")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin/timetable" });
  },
  head: () => ({ meta: pageMeta("Timetable - Studio Operator", "The DMC weekly class schedule and current operator assignments.") }),
  component: () => <AppShell><TimetableView /></AppShell>,
});
