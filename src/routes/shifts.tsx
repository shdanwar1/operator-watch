import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy path — the shift log now lives on the combined Record screen. */
export const Route = createFileRoute("/shifts")({
  beforeLoad: () => {
    throw redirect({ to: "/record" });
  },
});
