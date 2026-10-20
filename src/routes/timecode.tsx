import { useEffect, useRef, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ArrowLeft, Download, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getGateStatus } from "@/lib/gate.functions";
import { getClassTimecode, saveClassTimecode } from "@/lib/timecode.functions";
import {
  EMPTY_TIMECODE,
  MARKER_KINDS,
  buildEdl,
  elapsedMsOf,
  formatTimecode,
  framesAt,
  type MarkerKind,
  type TimecodeState,
} from "@/lib/timecode";
import { prefersInAppDisplay } from "@/lib/studio-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/timecode")({
  validateSearch: (s: Record<string, unknown>) => ({
    cid: str(s.cid),
    cn: str(s.cn),
    tn: str(s.tn),
    cd: str(s.cd),
    cs: str(s.cs),
    ce: str(s.ce),
  }),
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  head: () => ({
    meta: [
      { title: "Timecode" },
      { name: "description", content: "Mark highlight moments of a ballet class and export an EDL." },
      { property: "og:title", content: "Timecode" },
      { property: "og:description", content: "Mark ballet class moments and export an EDL." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TimecodePage,
});

const KIND_DOT: Record<MarkerKind, string> = {
  Correction: "bg-primary",
  Special: "bg-done",
  Highlight: "bg-live",
  End: "bg-alert",
};

function draftKey(cid: string) {
  return `timecode:${cid}`;
}

function TimecodePage() {
  const { cid, cn: clsName, tn, cd, cs, ce } = Route.useSearch();
  const [state, setState] = useState<TimecodeState>(EMPTY_TIMECODE);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState("");
  const [inApp, setInApp] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setInApp(prefersInAppDisplay()), []);

  useEffect(() => {
    if (!cid) return;
    let local: TimecodeState | null = null;
    try {
      const raw = localStorage.getItem(draftKey(cid));
      if (raw) local = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    if (local) setState(local);
    getClassTimecode({ data: { classId: cid } })
      .then((remote) => {
        if (remote && (!local || remote.markers.length >= local.markers.length)) setState(remote);
      })
      .catch(() => toast.error("Offline — using this device's copy"))
      .finally(() => setLoaded(true));
  }, [cid]);

  useEffect(() => {
    if (state.runningSince == null) return;
    const t = setInterval(() => setNow(Date.now()), 40);
    return () => clearInterval(t);
  }, [state.runningSince]);

  function commit(next: TimecodeState) {
    setState(next);
    if (!cid) return;
    try {
      localStorage.setItem(draftKey(cid), JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveClassTimecode({
        data: { classId: cid, className: clsName, teacherName: tn, date: cd, state: next },
      }).catch(() => toast.error("Could not save — kept on this device"));
    }, 400);
  }

  if (!cid) {
    return <div className="p-8 text-sm text-muted-foreground">Open Timecode from a Ballet class card.</div>;
  }

  const running = state.runningSince != null;
  const started = running || state.elapsedMs > 0 || state.markers.length > 0;
  const elapsed = elapsedMsOf(state, running ? now : Date.now());
  const frames = framesAt(elapsed);

  const toggle = () => {
    const t = Date.now();
    if (running) commit({ ...state, runningSince: null, elapsedMs: elapsedMsOf(state, t) });
    else commit({ ...state, runningSince: t });
  };

  const mark = (kind: MarkerKind, defNote: string) => {
    if (!running) return;
    const f = framesAt(elapsedMsOf(state, Date.now()));
    commit({
      ...state,
      markers: [...state.markers, { id: crypto.randomUUID(), frames: f, kind, note: note.trim() || defNote }],
    });
    setNote("");
  };

  const exportEdl = () => {
    const [y, m, d] = (cd ?? "").split("-");
    const [h, min] = (cs ?? "00:00").split(":");
    const base = `${(y ?? "").slice(2)}${m ?? ""}${d ?? ""}_${h}-${min}_${tn ?? ""}_${clsName ?? "Class"}`.replace(/\s+/g, "_");
    const blob = new Blob([buildEdl(base, state.markers)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}.edl`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Class length in frames for the start→end rail; fall back to the furthest marker.
  const classMin = (() => {
    if (!cs || !ce) return 60;
    const [sh, sm] = cs.split(":").map(Number);
    const [eh, em] = ce.split(":").map(Number);
    let v = eh * 60 + em - (sh * 60 + sm);
    if (v <= 0) v += 1440;
    return v;
  })();
  const span = Math.max(classMin * 60 * 25, ...state.markers.map((m) => m.frames - framesAt(0)), 1);
  const sorted = [...state.markers].sort((a, b) => b.frames - a.frames);

  return (
    <div className="mx-auto min-h-screen max-w-3xl space-y-6 p-4 sm:p-8">
      <header className="flex items-center gap-3">
        {inApp && (
          <Button size="icon" variant="ghost" onClick={() => history.back()} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{clsName ?? "Ballet class"}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {[tn, cd, cs && ce ? `${cs}–${ce}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportEdl} disabled={state.markers.length === 0}>
          <Download className="mr-1.5 h-4 w-4" /> Export EDL
        </Button>
      </header>

      <section className="rounded-2xl border border-border bg-card p-6 text-center">
        <div className="font-mono text-5xl font-semibold tabular-nums sm:text-7xl">{formatTimecode(frames)}</div>
        <p className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">25 fps · non-drop</p>
        <Button className="mt-5" size="lg" onClick={toggle} disabled={!loaded}>
          {running ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
          {running ? "Pause" : started ? "Resume" : "Start timecode"}
        </Button>
      </section>

      <section className="space-y-3">
        <Input
          placeholder="Optional note for the next marker"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {MARKER_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              disabled={!running}
              onClick={() => mark(k.kind, k.note)}
              className="flex h-20 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium transition active:scale-95 disabled:opacity-40"
            >
              <span className={cn("h-3 w-3 rounded-full", KIND_DOT[k.kind])} />
              {k.kind}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-1">
        <div className="relative h-6">
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
          <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-muted-foreground" />
          <span className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-muted-foreground" />
          {state.markers.map((m) => (
            <span
              key={m.id}
              title={formatTimecode(m.frames)}
              className={cn("absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded", KIND_DOT[m.kind])}
              style={{ left: `${Math.min(100, ((m.frames - framesAt(0)) / span) * 100)}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Start</span>
          <span>End</span>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Markers ({state.markers.length})
        </h2>
        {sorted.map((m) => (
          <div key={m.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", KIND_DOT[m.kind])} />
            <span className="font-mono text-sm tabular-nums">{formatTimecode(m.frames)}</span>
            <span className="w-20 shrink-0 text-xs text-muted-foreground">{m.kind}</span>
            <Input
              className="h-8 flex-1"
              value={m.note}
              maxLength={500}
              onChange={(e) =>
                commit({
                  ...state,
                  markers: state.markers.map((x) => (x.id === m.id ? { ...x, note: e.target.value } : x)),
                })
              }
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Delete marker"
              onClick={() => commit({ ...state, markers: state.markers.filter((x) => x.id !== m.id) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </section>
    </div>
  );
}
