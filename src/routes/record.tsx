import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { getGateStatus } from "@/lib/gate.functions";
import { getOperatorDisplayName } from "@/lib/operators.functions";
import { AttendanceSection } from "@/components/record/AttendanceSection";

/**
 * Record — one screen for the operator's own shift dataset: monthly
 * attendance totals and a history table whose rows expand to show each
 * shift's classes and notes. Replaces the former separate /shifts and
 * /earnings pages, which both described the same rows.
 */
export const Route = createFileRoute("/record")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  loader: async () => {
    const { username } = await getGateStatus();
    if (!username) return { username: null as string | null };
    const canonical = await getOperatorDisplayName({ data: { username } });
    return { username: canonical ?? username };
  },
  head: () => ({
    meta: pageMeta(PAGE_TITLES.record, "Your worked hours, attendance history and shift log."),
  }),
  component: RecordPage,
});

function RecordPage() {
  const { username } = Route.useLoaderData();
  return (
    <AppShell>
      <PageHeader title="Record" />
      <AttendanceSection username={username} />
    </AppShell>
  );
}
