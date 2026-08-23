import { createFileRoute, redirect } from "@tanstack/react-router";

/** The admin area opens directly on the calendar; this legacy route just redirects. */
export const Route = createFileRoute("/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/calendar" });
  },
});
