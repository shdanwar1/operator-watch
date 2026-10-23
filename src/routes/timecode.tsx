import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeft, Download, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getGateStatus } from "@/lib/gate.functions";
import { getClassTimecode, saveClassTimecode } from "@/lib/timecode.functions";
import { TimecodeTimeline, MARKER_DOT } from "@/components/TimecodeTimeline";
import { TimecodeLibrary } from "@/components/TimecodeLibrary";
import { AppShell } from "@/components/AppShell";
import {
  EMPTY_TIMECODE,
  MARKER_KINDS,
  buildEdl,
  classBoundaryMarkers,
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
      { title: "Timecode Studio · DMC" },
      { name: "description", content: "Mark highlight moments of a ballet class and export an EDL." },
      { property: "og:title", content: "Timecode Studio · DMC" },
      { property: "og:description", content: "Mark ballet class moments and export an EDL." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TimecodePage,
});

const KIND_DOT = MARKER_DOT;

/** Full-colour button styles matching the marker reference. */
const KIND_BUTTON: Partial<Record<MarkerKind, string>> = {
  Correction: "bg-marker-correction/15 text-marker-correction hover:bg-marker-correction/25",
  Tip: "bg-marker-tip/15 text-marker-tip hover:bg-marker-tip/25",
  Special: "bg-marker-special/15 text-marker-special hover:bg-marker-special/25",
  Dance: "bg-marker-dance/15 text-marker-dance hover:bg-marker-dance/25",
  End: "bg-secondary text-foreground hover:bg-secondary/80",
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
  const [markerEdit, setMarkerEdit] = useState<{ id: string; value: string } | null>(null);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const markerRows = useRef(new Map<string, HTMLDivElement>());
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
    const t = setInterval(() => setNow(Date.now()), state.runningSince == null ? 1000 : 40);
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

  if (!cid) return <TimecodeLibrary downloadEdl={downloadEdl} />;

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
      return commit({ ...state, elapsedMs: elapsedForFrames(f), runningSince: t, anchor: { at: t, frames: f }, recordingStartedAt: state.recordingStartedAt ?? t });
    }
    commit({ ...state, runningSince: t, anchor: { at: t, frames: framesAt(state.elapsedMs) }, recordingStartedAt: state.recordingStartedAt ?? t });
  };

  const mark = (kind: MarkerKind, defNote: string) => {
    if (!running || isExpired) return;
    const f = framesAt(elapsedMsOf(state, Date.now()));
    commit({
      ...state,
      markers: [
        ...state.markers,
        { id: crypto.randomUUID(), frames: f, kind, note: note.trim() || defNote, at: Date.now() },
      ],
    });
    setNote("");
  };


  // Rail spans the real scheduled class window (e.g. 15:45 → 16:45), not the timecode.
  const classMin = (() => {
    if (!cs || !ce) return 60;
    const [sh, sm] = cs.split(":").map(Number);
    const [eh, em] = ce.split(":").map(Number);
    let v = eh * 60 + em - (sh * 60 + sm);
    if (v <= 0) v += 1440;
    return v;
  })();
  const railStart = (() => {
    if (!cd || !cs) return null;
    const [y, mo, d] = cd.split("-").map(Number);
    const [h, mi] = cs.split(":").map(Number);
    return new Date(y, mo - 1, d, h, mi).getTime();
  })();
  const railMs = classMin * 60_000;
  const nowMs = now;
  /** Wall-clock time of a marker; older markers are inferred from the clock's offset. */
  const markerAt = (m: { frames: number; at?: number }) =>
    m.at ?? nowMs - ((frames - m.frames) * 1000) / 25;
  const autoMarkers = classBoundaryMarkers(state.anchor, railStart, railStart == null ? null : railStart + railMs);
  const allMarkers = [...state.markers, ...autoMarkers];
  const isExpired = railStart != null && now > railStart + railMs + 10 * 60_000;
  // Recording start: first Start press, else inferred from the last anchor.
  const recStart = state.recordingStartedAt ?? (state.anchor ? state.anchor.at - elapsedForFrames(state.anchor.frames) : null);
  const saveMarkerTime = () => {
    if (!markerEdit) return;
    const f = parseTimecode(markerEdit.value);
    if (f == null) return void toast.error("Enter timecode as HH:MM:SS:FF");
    commit({
      ...state,
      markers: state.markers.map((x) =>
        x.id === markerEdit.id ? { ...x, frames: f, at: markerAt(x) + ((f - x.frames) * 1000) / 25 } : x,
      ),
    });
    setMarkerEdit(null);
  };
  const exportEdl = () =>
    downloadEdl(timecodeFilename({ date: cd, start: cs, teacher: tn, className: clsName }), allMarkers);
  const sorted = [...allMarkers].sort((a, b) => b.frames - a.frames);

  return (
    <AppShell>
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <header className="flex items-center gap-3">
        <Button size="icon" variant="ghost" asChild aria-label="All timecodes" title="All timecodes">
          <Link to="/timecode" search={{ cid: undefined, cn: undefined, tn: undefined, cd: undefined, cs: undefined, ce: undefined }}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{clsName ?? "Ballet class"}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {[tn, cd, cs && ce ? `${cs}–${ce}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportEdl} disabled={allMarkers.length === 0}>
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
            className="w-full bg-transparent text-center tc-num text-5xl font-semibold outline-none ring-1 ring-primary rounded-lg sm:text-7xl"
          />
        ) : (
          <button
            type="button"
            disabled={running}
            onClick={() => setTcEdit(formatTimecode(frames))}
            title={running ? "Pause to edit" : "Click to type the recording's timecode"}
            className="group inline-flex items-center gap-3 tc-num text-5xl font-semibold sm:text-7xl"
          >
            {formatTimecode(frames)}
            {!running && <Pencil className="h-5 w-5 text-muted-foreground opacity-60 group-hover:opacity-100" />}
          </button>
        )}
        <p className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          25 fps · non-drop{!running ? " · click the time to set it" : ""}
        </p>
        {isExpired && !running ? (
          <p className="mt-5 text-sm font-medium text-muted-foreground">Concluded</p>
        ) : (
          <Button className="mt-5" size="lg" onClick={toggle} disabled={!loaded}>
            {running ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            {running ? "Pause" : started ? "Resume" : "Start timecode"}
          </Button>
        )}
      </section>

      <section className="space-y-3">
        <Input
          placeholder="Optional note for the next marker"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
        <div className="grid grid-cols-5 gap-2">
          {MARKER_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              disabled={!running || isExpired}
              onClick={() => mark(k.kind, k.note)}
              className={cn(
                "flex h-14 items-center justify-center rounded-md text-sm font-semibold transition active:scale-95 disabled:opacity-40",
                KIND_BUTTON[k.kind],
              )}
            >
              {k.kind}
            </button>
          ))}
        </div>
      </section>

      <TimecodeTimeline markers={allMarkers} start={railStart} durationMs={railMs} now={now}
        startLabel={cs && `${cs} Start`} endLabel={ce && `${ce} End`} markerAt={markerAt} running={running} recordingStart={recStart} selected={selectedMarker}
        onSelect={(id, jump) => {
          setSelectedMarker(id);
          if (jump) {
            const row = markerRows.current.get(id);
            row?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
            row?.focus({ preventScroll: true });
          }
        }} />

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Markers ({allMarkers.length})
        </h2>
        {sorted.map((m) => (
          <div key={m.id} tabIndex={-1} data-marker-id={m.id}
            ref={node => { if (node) markerRows.current.set(m.id, node); else markerRows.current.delete(m.id); }}
            className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 scroll-mt-20 transition-colors outline-none", selectedMarker === m.id && "border-live/60 bg-live-soft ring-1 ring-live/30")} >
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", KIND_DOT[m.kind])} />
            {markerEdit?.id === m.id ? (
              <input autoFocus value={markerEdit.value} aria-label="Edit marker timecode"
                onChange={(e) => setMarkerEdit({ id: m.id, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") saveMarkerTime(); if (e.key === "Escape") setMarkerEdit(null); }}
                onBlur={() => setMarkerEdit(null)}
                className="w-28 rounded bg-transparent px-1 tc-num text-sm outline-none ring-1 ring-primary" />
            ) : m.id.startsWith("auto-") ? (
              <span className="tc-num text-sm">{formatTimecode(m.frames)}</span>
            ) : (
              <button type="button" title="Click to edit the time" onClick={() => setMarkerEdit({ id: m.id, value: formatTimecode(m.frames) })}
                className="tc-num text-sm underline-offset-4 hover:underline">{formatTimecode(m.frames)}</button>
            )}
            <span className="w-20 shrink-0 text-xs text-muted-foreground">{m.kind}</span>
            {m.id.startsWith("auto-") ? (
              <span className="flex-1 text-sm">{m.note} <span className="text-xs text-muted-foreground">· automatic</span></span>
            ) : (
            <>
            <Input
              className="h-8 min-w-24 flex-1"
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
            </>
            )}
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

