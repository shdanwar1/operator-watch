import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Monitor } from "lucide-react";
import { getGateStatus } from "@/lib/gate.functions";
import { AppShell, PageHeader } from "@/components/AppShell";
import { StudioDisplayPanel } from "@/components/StudioDisplayPanel";
import { parseTemporaryClass, type TemporaryClassSearch } from "@/lib/studio-presets";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/studio-display")({
  validateSearch: (search: Record<string, unknown>): TemporaryClassSearch => ({
    cid: str(search.cid),
    cn: str(search.cn),
    tn: str(search.tn),
    cd: str(search.cd),
    cs: str(search.cs),
    ce: str(search.ce),
  }),
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  head: () => ({
    meta: pageMeta(
      PAGE_TITLES.studioDisplay,
      "Launch the teacher-facing studio display from a preset, a saved setup, or a scheduled class.",
    ),
  }),
  component: StudioDisplaySettingsPage,
});

function StudioDisplaySettingsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const temporaryClass = parseTemporaryClass(search);

  return (
    <AppShell>
      {/* Desktop: preset launcher. */}
      <div className="max-lg:hidden">
        <PageHeader eyebrow="Teacher-facing screen" title="Studio Display" />
        <StudioDisplayPanel
          temporaryClass={temporaryClass}
          onDismissTemporary={() =>
            navigate({ to: "/studio-display", search: {}, replace: true })
          }
        />
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
