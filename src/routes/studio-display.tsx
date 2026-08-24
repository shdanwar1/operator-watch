import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { getGateStatus } from "@/lib/gate.functions";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { StudioDisplayPanel } from "@/components/StudioDisplayPanel";


export const Route = createFileRoute("/studio-display")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  head: () => ({
    meta: pageMeta(
      PAGE_TITLES.studioDisplayConfig,
      "Configure the custom studio display timer and teacher notes, then open the display window.",
    ),
  }),
  component: StudioDisplaySettingsPage,
});

function StudioDisplaySettingsPage() {
  const openRef = useRef<(() => void) | null>(null);
  return (
    <AppShell>
      <PageHeader
        eyebrow="Teacher-facing screen"
        title="Custom Studio Display"
        action={
          <Button onClick={() => openRef.current?.()} className="rounded-full">
            Open display
            <ArrowUpRight className="ml-1.5 h-4 w-4" />
          </Button>
        }
      />
      <StudioDisplayPanel openRef={openRef} />
    </AppShell>
  );

}
