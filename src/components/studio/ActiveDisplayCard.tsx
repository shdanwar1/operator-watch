import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowUpRight } from "lucide-react";
import { notesEditable, type StudioDisplayState } from "@/lib/studio-display";
import { fmtClock } from "@/lib/class-interval";

/**
 * The single live control surface for the one active Studio Display session.
 * Everything is read from — and written straight back into — the shared state,
 * so an open /display picks up note edits through the existing channel.
 */
export function ActiveDisplayCard({
  state,
  onNotesChange,
  onOpenDisplay,
  onEndSession,
}: {
  state: StudioDisplayState;
  onNotesChange: (notes: string) => void;
  onOpenDisplay: () => void;
  onEndSession: () => void;
}) {
  const [, force] = useState(0);

  // Re-evaluates the notes window against the shared timer, no second engine.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const canEditNotes = notesEditable(state, new Date());
  const title =
    state.className || state.presetLabel || "Studio Display";
  const timeLine = state.endTime
    ? `${fmtClock(state.startTime)} – ${fmtClock(state.endTime)} · ${state.durationMin} min`
    : `${fmtClock(state.startTime)} · ${state.durationMin} min`;

  return (
    <Card className="border-2 border-primary/40">
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Active display
          </p>
          <h2 className="mt-2 text-base font-semibold tracking-tight">{title}</h2>
          {state.teacherName ? (
            <p className="text-sm text-muted-foreground">{state.teacherName}</p>
          ) : null}
          <p className="text-sm tabular-nums text-muted-foreground">{timeLine}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="active-notes" className="text-xs">
            Notes for display
          </Label>
          <textarea
            id="active-notes"
            rows={3}
            value={state.notes}
            disabled={!canEditNotes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder={canEditNotes ? "Welcome everyone…" : "Available during class"}
            className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button className="rounded-full" onClick={onOpenDisplay}>
            Open Display
            <ArrowUpRight className="ml-1.5 h-4 w-4" />
          </Button>
          <Button variant="ghost" className="rounded-full" onClick={onEndSession}>
            End session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
