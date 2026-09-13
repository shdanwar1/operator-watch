import { createFileRoute, redirect } from "@tanstack/react-router";

/** The admin area opens on the current-week operator board. */
export const Route = createFileRoute("/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/live-timetable" });
  },
});
