import { createFileRoute } from "@tanstack/react-router";
import { TimetableView } from "@/components/timetable/TimetableView";
import { pageMeta } from "@/lib/page-titles";
export const Route = createFileRoute("/admin/timetable")({
  head: () => ({ meta: pageMeta("Timetable - Studio Admin", "Current-month DMC timetable and operator assignments.") }),
  component: () => <TimetableView admin />,
});
