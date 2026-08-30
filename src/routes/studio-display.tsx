import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useRef } from "react";
import { ArrowUpRight, Monitor } from "lucide-react";
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
      {/* Desktop: full configuration panel. */}
      <div className="max-lg:hidden">
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
      </div>

      {/* Mobile: the display is a desktop-only surface. */}
      <div className="flex flex-col items-center gap-3 px-6 py-20 text-center lg:hidden">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/60">
          <Monitor className="h-6 w-6 text-muted-foreground" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">Desktop only</h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          The Studio Display is designed for desktop. Open this page on a
          computer to configure and launch the display.
        </p>
      </div>
    </AppShell>
  );

}
