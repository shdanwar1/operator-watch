import { useEffect, useState } from "react";
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

/**
 * Desktop is the primary surface, but an installed (standalone) web app is a
 * supported one too — that is the flow operators use on iOS. Resolved after
 * hydration so SSR markup stays stable.
 */
function useSupportedSurface() {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    const compute = () => {
      const standalone =
        window.matchMedia?.("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setSupported(standalone || window.innerWidth >= 1024);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return supported;
}

function StudioDisplaySettingsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const temporaryClass = parseTemporaryClass(search);
  const supported = useSupportedSurface();

  if (supported === null) return <AppShell>{null}</AppShell>;

  return (
    <AppShell>
      {supported ? (
        <div>
          <PageHeader title="Studio Display" />
          <StudioDisplayPanel
            temporaryClass={temporaryClass}
            onDismissTemporary={() =>
              navigate({ to: "/studio-display", search: {}, replace: true })
            }
          />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/60">
            <Monitor className="h-6 w-6 text-muted-foreground" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">Desktop only</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            The Studio Display is designed for desktop. Open this page on a
            computer, or install the app to your home screen, to configure and
            launch the display.
          </p>
        </div>
      )}
    </AppShell>
  );
}
