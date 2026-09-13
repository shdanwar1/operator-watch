import { createFileRoute, redirect } from "@tanstack/react-router";

/** The admin area opens on the current-month timetable. */
export const Route = createFileRoute("/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/timetable" });
  },
});
