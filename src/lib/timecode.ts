/** Ballet timecode helpers: 25 fps non-drop-frame, starting at 01:00:00:00. */
export const FPS = 25;
export const START_FRAMES = 60 * 60 * FPS; // 01:00:00:00

export type MarkerKind = "Correction" | "Special" | "Highlight" | "End";

export const MARKER_KINDS: { kind: MarkerKind; color: string; note: string }[] = [
  { kind: "Correction", color: "Blue", note: "Start" },
  { kind: "Special", color: "Green", note: "Start" },
  { kind: "Highlight", color: "Yellow", note: "Start" },
  { kind: "End", color: "Blue", note: "Of" },
];

export type TimecodeMarker = {
  id: string;
  frames: number;
  kind: MarkerKind;
  note: string;
};

export type TimecodeState = {
  /** Epoch ms when the clock was (re)started; null when not running. */
  runningSince: number | null;
  /** Elapsed ms accumulated before the current run. */
  elapsedMs: number;
  markers: TimecodeMarker[];
};

export const EMPTY_TIMECODE: TimecodeState = { runningSince: null, elapsedMs: 0, markers: [] };

export function elapsedMsOf(s: TimecodeState, now: number): number {
  return s.elapsedMs + (s.runningSince != null ? Math.max(0, now - s.runningSince) : 0);
}

/** Wall-clock elapsed → absolute timecode frames. */
export function framesAt(elapsedMs: number): number {
  return START_FRAMES + Math.floor((Math.max(0, elapsedMs) * FPS) / 1000);
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
  return MARKER_KINDS.find((k) => k.kind === kind)?.color ?? "Blue";
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
