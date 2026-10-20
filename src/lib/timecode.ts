/** Ballet timecode helpers: 25 fps non-drop-frame, starting at 01:00:00:00. */
export const FPS = 25;
export const START_FRAMES = 60 * 60 * FPS; // 01:00:00:00

/** "Highlight" is kept only so older saved markers still load and export. */
export type MarkerKind = "Correction" | "Tip" | "Special" | "Dance" | "End" | "Highlight";

export const MARKER_KINDS: { kind: MarkerKind; color: string; note: string }[] = [
  { kind: "Correction", color: "Blue", note: "Start" },
  { kind: "Tip", color: "Red", note: "Start" },
  { kind: "Special", color: "Green", note: "Start" },
  { kind: "Dance", color: "Purple", note: "Start" },
  { kind: "End", color: "Blue", note: "Of" },
];

const LEGACY_COLORS: Partial<Record<MarkerKind, string>> = { Highlight: "Yellow" };

export type TimecodeMarker = {
  id: string;
  frames: number;
  kind: MarkerKind;
  note: string;
  /** Wall-clock epoch ms when the marker was tapped (absent on older markers). */
  at?: number;
};

export type TimecodeState = {
  /** Epoch ms when the clock was (re)started; null when not running. */
  runningSince: number | null;
  /** Elapsed ms accumulated before the current run. */
  elapsedMs: number;
  markers: TimecodeMarker[];
  /** Last known wall-clock ↔ timecode pairing, set whenever the clock starts. */
  anchor?: { at: number; frames: number };
};

/** Timecode frames for a wall-clock instant using the stored anchor. */
export function framesForWallClock(anchor: { at: number; frames: number }, t: number): number {
  return Math.max(0, anchor.frames + Math.round(((t - anchor.at) * FPS) / 1000));
}

/** Automatic Class Start / Class End markers placed at the scheduled times. */
export function classBoundaryMarkers(
  anchor: TimecodeState["anchor"],
  startMs: number | null,
  endMs: number | null,
): TimecodeMarker[] {
  if (!anchor || startMs == null || endMs == null) return [];
  return [
    { id: "auto-class-start", frames: framesForWallClock(anchor, startMs), kind: "Special", note: "Class Start", at: startMs },
    { id: "auto-class-end", frames: framesForWallClock(anchor, endMs), kind: "End", note: "Class End", at: endMs },
  ];
}

export const EMPTY_TIMECODE: TimecodeState = { runningSince: null, elapsedMs: 0, markers: [] };

export function elapsedMsOf(s: TimecodeState, now: number): number {
  return s.elapsedMs + (s.runningSince != null ? Math.max(0, now - s.runningSince) : 0);
}

/** Wall-clock elapsed → absolute timecode frames (elapsed may be negative after a manual set). */
export function framesAt(elapsedMs: number): number {
  return Math.max(0, START_FRAMES + Math.floor((elapsedMs * FPS) / 1000));
}

/** Absolute frames → elapsed ms on the 01:00:00:00-anchored clock. */
export function elapsedForFrames(frames: number): number {
  return ((frames - START_FRAMES) * 1000) / FPS;
}

/** Parse "HH:MM:SS:FF" (also accepts 8 bare digits); null when invalid. */
export function parseTimecode(input: string): number | null {
  const s = input.trim();
  const m = /^(\d{1,2})[:;.](\d{1,2})[:;.](\d{1,2})[:;.](\d{1,2})$/.exec(s) ?? /^(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const [hh, mm, ss, ff] = m.slice(1).map(Number);
  if (hh > 23 || mm > 59 || ss > 59 || ff >= FPS) return null;
  return ((hh * 60 + mm) * 60 + ss) * FPS + ff;
}

/** YYMMDD_HH-MM_Teacher_Class — same as the class filename. */
export function timecodeFilename(c: { date?: string | null; start?: string | null; teacher?: string | null; className?: string | null }): string {
  const [y = "", m = "", d = ""] = (c.date ?? "").split("-");
  const [h = "00", min = "00"] = (c.start ?? "00:00").split(":");
  return `${y.slice(2)}${m}${d}_${h}-${min}_${c.teacher ?? ""}_${c.className || "Class"}`;
}

export function formatTimecode(frames: number): string {
  const f = Math.max(0, Math.floor(frames));
  const ff = f % FPS;
  const totalSec = Math.floor(f / FPS);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

function colorOf(kind: MarkerKind): string {
  return MARKER_KINDS.find((k) => k.kind === kind)?.color ?? LEGACY_COLORS[kind] ?? "Blue";
}

/** EditingTools / DaVinci Resolve marker EDL, events ordered by timecode. */
export function buildEdl(title: string, markers: TimecodeMarker[]): string {
  const sorted = [...markers].sort((a, b) => a.frames - b.frames);
  const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  sorted.forEach((m, i) => {
    const tc = formatTimecode(m.frames);
    const n = String(i + 1).padStart(3, "0");
    lines.push(`${n}  001      V     C        ${tc} ${tc} ${tc} ${tc}`);
    const note = (m.note || m.kind).replace(/[\r\n|]+/g, " ").trim();
    lines.push(`${note} |C:ResolveColor${colorOf(m.kind)} |M:${m.kind} |D:0`);
    lines.push("");
  });
  return lines.join("\n");
}

/** Ballet = 60-minute class or a ballet/barre name. */
export function isBalletClass(c: { className: string; durationMinutes: number }): boolean {
  return c.durationMinutes === 60 || /ballet|barre/i.test(c.className);
}
