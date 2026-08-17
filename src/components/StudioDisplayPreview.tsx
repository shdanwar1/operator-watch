import { computeStage, formatMMSS, type StudioDisplayState } from "@/lib/studio-display";

/**
 * Miniature render of the teacher-facing Studio Display.
 * Derives everything from the same shared state + computeStage() the real
 * /display window uses, so preview and display can never drift.
 */
export function StudioDisplayPreview({ state }: { state: StudioDisplayState }) {
  const stage = computeStage(state);
  const isBefore = stage.phase === "before" || stage.phase === "countdown10";
  const dark = stage.fg === "dark";
  const notes = state.notes.trim();

  return (
    <div
      className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl px-5 text-center"
      style={{
        backgroundColor: stage.bgColor,
        transition: "background-color 600ms ease",
        color: dark ? "#171717" : "#ffffff",
      }}
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.28em] opacity-60">
        {isBefore ? "Next class" : stage.label || "\u00a0"}
      </div>
      <div className="font-mono text-[clamp(2rem,5vw,3.25rem)] font-bold leading-none tabular-nums">
        {stage.phase === "countdown10"
          ? (stage.bigNumber ?? 1)
          : formatMMSS(stage.timerMs)}
      </div>
      {isBefore && <div className="text-[11px] opacity-60">starts in</div>}
      {notes && (
        <p className="mt-3 line-clamp-4 text-[13px] leading-snug opacity-85">{notes}</p>
      )}
    </div>
  );
}

/** Short status word for the preview header, e.g. "22:45 · waiting". */
export function previewStatus(state: StudioDisplayState) {
  const phase = computeStage(state).phase;
  const word =
    phase === "before" || phase === "countdown10"
      ? "waiting"
      : phase === "qa"
        ? "Q&A"
        : phase === "idle"
          ? "idle"
          : "live";
  return `${state.startTime} · ${word}`;
}
