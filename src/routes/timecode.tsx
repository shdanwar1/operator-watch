import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeft, Download, Pause, Pencil, Play, Timer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getGateStatus } from "@/lib/gate.functions";
import { getClassTimecode, listPastTimecodes, saveClassTimecode, type PastTimecode } from "@/lib/timecode.functions";
import { AppShell } from "@/components/AppShell";
import {
  EMPTY_TIMECODE,
  MARKER_KINDS,
  buildEdl,
  elapsedForFrames,
  elapsedMsOf,
  parseTimecode,
  timecodeFilename,
  formatTimecode,
  framesAt,
  type MarkerKind,
  type TimecodeState,
} from "@/lib/timecode";
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
  const [tcEdit, setTcEdit] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  if (!cid) return <TimecodeLibrary />;

  const running = state.runningSince != null;
  const started = running || state.elapsedMs > 0 || state.markers.length > 0;
  const elapsed = elapsedMsOf(state, running ? now : Date.now());
  const frames = framesAt(elapsed);

  /** Apply a typed timecode; returns false when invalid. */
  const applyTyped = (): boolean => {
    if (tcEdit == null) return true;
    const f = parseTimecode(tcEdit);
    if (f == null) {
      toast.error("Enter timecode as HH:MM:SS:FF");
      return false;
    }
    setTcEdit(null);
    commit({ ...state, runningSince: null, elapsedMs: elapsedForFrames(f) });
    return true;
  };

  const toggle = () => {
    const t = Date.now();
    if (running) return commit({ ...state, runningSince: null, elapsedMs: elapsedMsOf(state, t) });
    if (tcEdit != null) {
      const f = parseTimecode(tcEdit);
      if (f == null) return void toast.error("Enter timecode as HH:MM:SS:FF");
      setTcEdit(null);
      return commit({ ...state, elapsedMs: elapsedForFrames(f), runningSince: t });
    }
    commit({ ...state, runningSince: t });
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

  const exportEdl = () =>
    downloadEdl(timecodeFilename({ date: cd, start: cs, teacher: tn, className: clsName }), state.markers);

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
    <AppShell>
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <header className="flex items-center gap-3">
        <Button size="icon" variant="ghost" asChild aria-label="All timecodes" title="All timecodes">
          <Link to="/timecode" search={{}}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
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
        {tcEdit != null ? (
          <input
            autoFocus
            value={tcEdit}
            onChange={(e) => setTcEdit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyTyped();
              if (e.key === "Escape") setTcEdit(null);
            }}
            aria-label="Set timecode"
            className="w-full bg-transparent text-center font-mono text-5xl font-semibold tabular-nums outline-none ring-1 ring-primary rounded-lg sm:text-7xl"
          />
        ) : (
          <button
            type="button"
            disabled={running}
            onClick={() => setTcEdit(formatTimecode(frames))}
            title={running ? "Pause to edit" : "Click to type the recording's timecode"}
            className="group inline-flex items-center gap-3 font-mono text-5xl font-semibold tabular-nums sm:text-7xl"
          >
            {formatTimecode(frames)}
            {!running && <Pencil className="h-5 w-5 text-muted-foreground opacity-60 group-hover:opacity-100" />}
          </button>
        )}
        <p className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          25 fps · non-drop{!running ? " · click the time to set it" : ""}
        </p>
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
    </AppShell>
  );
}

function downloadEdl(base: string, markers: TimecodeState["markers"]) {
  const name = base.replace(/\s+/g, "_");
  const blob = new Blob([buildEdl(name, markers)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.edl`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function TimecodeLibrary() {
  const [rows, setRows] = useState<PastTimecode[] | null>(null);
  useEffect(() => {
    listPastTimecodes()
      .then(setRows)
      .catch(() => {
        toast.error("Could not load timecodes");
        setRows([]);
      });
  }, []);
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-8">
        <header>
          <h1 className="text-lg font-semibold">Timecodes</h1>
          <p className="text-xs text-muted-foreground">
            Start a timecode from the timer icon on a Ballet class card. Saved timecodes appear here.
          </p>
        </header>
        {rows == null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No saved timecodes yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const name = timecodeFilename({ date: r.date, start: r.start, teacher: r.teacherName, className: r.className });
              return (
                <li key={r.classId} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                  <Timer className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.className ?? "Ballet class"}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {name}.edl · {r.state.markers.length} markers
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" asChild>
                    <Link
                      to="/timecode"
                      search={{
                        cid: r.classId,
                        cn: r.className ?? undefined,
                        tn: r.teacherName ?? undefined,
                        cd: r.date ?? undefined,
                        cs: r.start ?? undefined,
                        ce: r.end ?? undefined,
                      }}
                    >
                      Open
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => downloadEdl(name, r.state.markers)}>
                    <Download className="mr-1.5 h-4 w-4" /> EDL
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
