import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy path — Attendance now lives on the combined Record screen. */
export const Route = createFileRoute("/earnings")({
  beforeLoad: () => {
    throw redirect({ to: "/record" });
  },
});
