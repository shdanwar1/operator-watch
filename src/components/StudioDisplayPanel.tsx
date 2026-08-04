import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Monitor, Timer } from "lucide-react";
import { useStudioDisplay } from "@/hooks/useStudioDisplay";
import { computeStage, formatMMSS, MIN_DURATION_MIN } from "@/lib/studio-display";

export function StudioDisplayPanel() {
  const { state, update, ready } = useStudioDisplay("control");
  const [, force] = useState(0);
  const displayWinRef = useRef<Window | null>(null);

  // 1s ticker
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!ready) return null;

  const stage = computeStage(state);
  const label = stage.label;

  const openDisplay = () => {
    if (displayWinRef.current && !displayWinRef.current.closed) {
      displayWinRef.current.focus();
      return;
    }
    const win = window.open("/display", "studio-display", "popup,width=1280,height=800");
    if (win) displayWinRef.current = win;
  };

  return (
    <Card>
      <CardContent className="space-y-5 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Studio Display</h3>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Timer mode</Label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "next", label: "Next Scheduled Class" },
              { value: "running", label: "Join Running Class" },
            ] as const).map((opt) => {
              const active = (state.timerMode ?? "next") === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update({ timerMode: opt.value })}
                  aria-pressed={active}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {(state.timerMode ?? "next") === "next"
              ? "Resolves to the next occurrence of that time (handles midnight classes)."
              : "Treats the time as today — use to join a class already in progress."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sd-start" className="text-xs">Class starts at</Label>
            <Input
              id="sd-start"
              type="time"
              value={state.startTime}
              onChange={(e) => update({ startTime: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sd-dur" className="text-xs">Duration (min)</Label>
            <Input
              id="sd-dur"
              type="number"
              min={MIN_DURATION_MIN}
              value={state.durationMin}
              onChange={(e) => update({ durationMin: Math.max(MIN_DURATION_MIN, parseInt(e.target.value) || MIN_DURATION_MIN) })}
            />
          </div>
        </div>


        <div className="rounded-lg border bg-muted/30 px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 font-mono text-3xl font-semibold tabular-nums">
            {formatMMSS(stage.timerMs)}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sd-notes" className="text-xs">Notes</Label>
          <textarea
            id="sd-notes"
            value={state.notes}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="Welcome everyone! Today's focus is…"
            rows={4}
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <Button onClick={openDisplay} className="w-full" size="lg">
          <Monitor className="mr-2 h-4 w-4" />
          Open Display Screen
        </Button>
        <p className="text-center text-[11px] text-muted-foreground">
          Opens a new window with the live timer & notes for the teacher.
        </p>
      </CardContent>
    </Card>
  );
}
