import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStudioDisplay } from "@/hooks/useStudioDisplay";
import { MIN_DURATION_MIN } from "@/lib/studio-display";
import { StudioDisplayPreview, previewStatus } from "@/components/StudioDisplayPreview";

const MODES = [
  { value: "next", label: "Upcoming" },
  { value: "running", label: "Current" },
] as const;

export function StudioDisplayPanel({
  openRef,
}: {
  /** Lets the page header's "Open display" button drive this panel. */
  openRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { state, update, ready } = useStudioDisplay("control");
  const [, force] = useState(0);
  const displayWinRef = useRef<Window | null>(null);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!openRef) return;
    openRef.current = () => {
      if (displayWinRef.current && !displayWinRef.current.closed) {
        displayWinRef.current.focus();
        return;
      }
      const win = window.open("/display", "studio-display", "popup,width=1280,height=800");
      if (win) displayWinRef.current = win;
    };
    return () => {
      openRef.current = null;
    };
  }, [openRef]);

  if (!ready) return null;

  const mode = state.timerMode ?? "next";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
      <Card>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <h2 className="truncate text-base font-semibold tracking-tight">Timer setup</h2>
            <div className="flex shrink-0 rounded-full bg-muted p-1">
              {MODES.map((opt) => {
                const active = mode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => update({ timerMode: opt.value })}
                    className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                      active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <Label htmlFor="sd-start" className="text-[13px] font-medium">
                Class starts
              </Label>
              <Input
                id="sd-start"
                type="time"
                className="mt-3 h-11 text-base"
                value={state.startTime}
                onChange={(e) => update({ startTime: e.target.value })}
              />
            </div>
            <div className="rounded-xl border p-4">
              <Label htmlFor="sd-dur" className="text-[13px] font-medium">
                Duration
              </Label>
              <Input
                id="sd-dur"
                type="number"
                className="mt-3 h-11 text-base"
                min={MIN_DURATION_MIN}
                value={state.durationMin}
                onChange={(e) =>
                  update({
                    durationMin: Math.max(
                      MIN_DURATION_MIN,
                      parseInt(e.target.value) || MIN_DURATION_MIN,
                    ),
                  })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sd-notes" className="text-[13px] font-medium">
              Notes
            </Label>
            <textarea
              id="sd-notes"
              value={state.notes}
              onChange={(e) => update({ notes: e.target.value })}
              placeholder="Welcome everyone..."
              rows={5}
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <h2 className="truncate text-base font-semibold tracking-tight">Live preview</h2>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {previewStatus(state)}
            </span>
          </div>
          <StudioDisplayPreview state={state} />
        </CardContent>
      </Card>
    </div>
  );
}
