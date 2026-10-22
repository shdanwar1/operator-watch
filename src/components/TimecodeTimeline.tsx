import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { classProgress, formatTimecode, type MarkerKind, type TimecodeMarker } from "@/lib/timecode";

export const MARKER_DOT: Record<MarkerKind, string> = {
  Correction: "bg-marker-correction", Tip: "bg-marker-tip", Special: "bg-marker-special",
  Dance: "bg-marker-dance", End: "bg-muted-foreground", Highlight: "bg-warn",
};

export function TimecodeTimeline({ markers, start, durationMs, now, startLabel, endLabel, markerAt, onSelect, selected }: {
  markers: TimecodeMarker[]; start: number | null; durationMs: number; now: number;
  startLabel?: string; endLabel?: string; markerAt: (m: TimecodeMarker) => number;
  onSelect: (id: string, jump: boolean) => void; selected: string | null;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const progress = classProgress(now, start, durationMs);
  const rail = useRef<HTMLDivElement>(null);
  const active = markers.find(m => m.id === hovered);
  return <section aria-label="Class timeline" className="space-y-2 py-2">
    <div className="flex justify-between text-xs text-muted-foreground">
      <span>Class timeline</span>
      <span className="tc-num">{start == null ? "Schedule unavailable" : now < start ? "Not started" : now >= start + durationMs ? "Class ended" : `${Math.floor((now - start) / 60_000)} / ${durationMs / 60_000} min`}</span>
    </div>
    <div ref={rail} className="relative mx-3 h-14">
      <div className="absolute inset-x-0 top-8 h-1 rounded-full bg-border" />
      <div className="absolute left-0 top-8 h-1 rounded-full bg-live/30" style={{ width: `${progress}%` }} />
      {start != null && <div aria-label="Now playhead" className="pointer-events-none absolute top-2 z-20 h-10 -translate-x-1/2" style={{ left: `${progress}%` }}>
        <span className={cn("absolute top-0 text-[10px] font-semibold text-live", progress > 90 ? "right-1" : "left-1")}>Now</span>
        <span className="tc-playhead absolute bottom-0 left-0 h-7 w-0.5 bg-live" />
      </div>}
      {start != null && markers.map(m => <Button key={m.id} variant="ghost" size="icon"
        aria-label={`Select ${m.kind} marker ${formatTimecode(m.frames)}`} aria-pressed={selected === m.id}
        onMouseEnter={() => { setHovered(m.id); onSelect(m.id, false); }} onMouseLeave={() => setHovered(null)}
        onFocus={() => { setHovered(m.id); onSelect(m.id, false); }} onBlur={() => setHovered(null)}
        onClick={() => onSelect(m.id, true)}
        className="absolute top-5 z-10 h-8 w-6 -translate-x-1/2 rounded-sm p-0 hover:bg-accent/60"
        style={{ left: `${classProgress(markerAt(m), start, durationMs)}%` }}>
        <span className={cn("h-4 w-1 rounded-sm transition-transform", MARKER_DOT[m.kind], selected === m.id && "scale-y-150 ring-2 ring-ring/50")} />
      </Button>)}
    </div>
    <div className="flex justify-between text-[11px] text-muted-foreground tc-num"><span>{startLabel ?? "Start"}</span><span>{endLabel ?? "End"}</span></div>
    <div className="min-h-5 text-xs text-muted-foreground" aria-live="polite">{active ? `${formatTimecode(active.frames)} · ${active.kind} · ${active.note}` : "\u00a0"}</div>
  </section>;
}