import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useStudioDisplay } from "@/hooks/useStudioDisplay";
import { computeStage, formatMMSS, resolveStartAt, type StageInfo } from "@/lib/studio-display";
import { pickPrompt, CATEGORY_LABEL } from "@/lib/icebreakers";

export const Route = createFileRoute("/display")({
  component: DisplayScreen,
  head: () => ({
    meta: [
      { title: "Studio Display" },
      { name: "description", content: "Live class timer and instructor guidance." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

// Show the icebreaker panel only when class is within 5 min of starting.
const PRECLASS_WINDOW_MS = 5 * 60_000;

function useTicker(ms = 250) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Track container aspect ratio to switch portrait/landscape layouts. */
function useAspect() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState(16 / 9);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setRatio(w / h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ratio, isLandscape: ratio >= 1.35 };
}

function DisplayScreen() {
  const { state, ready } = useStudioDisplay("display");
  useTicker(250);
  const { ref, isLandscape } = useAspect();

  if (!ready) return null;

  const now = new Date();
  const stage = computeStage(state, now);
  const startAt = resolveStartAt(state.startTime, now);
  const untilStart = startAt.getTime() - now.getTime();

  const showPreClass =
    (stage.phase === "before" && untilStart <= PRECLASS_WINDOW_MS) ||
    stage.phase === "countdown10";
  const prompt = pickPrompt(now);

  const textClass = stage.fg === "dark" ? "text-neutral-900" : "text-white";

  return (
    <div ref={ref} className={`fixed inset-0 overflow-hidden ${textClass}`}>
      {/* Background layer — 10s cross-fade between stage colors. */}
      <div
        aria-hidden
        className={`absolute inset-0 ${stage.pulse && stage.phase === "final30" ? "sd-pulse-bg" : ""}`}
        style={{
          backgroundColor: stage.bgColor,
          transition: "background-color 10000ms cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "background-color",
        }}
      />

      {/* Content */}
      <div
        className="relative z-10 flex h-full w-full items-center justify-center"
        style={{ padding: "clamp(0.75rem, 3vmin, 3.5rem)" }}
      >
        {stage.phase === "countdown10" ? (
          <CountdownCinematic n={stage.bigNumber ?? 1} />
        ) : showPreClass ? (
          isLandscape ? (
            <PreClassLandscape stage={stage} startsAt={state.startTime} prompt={prompt} notes={state.notes} />
          ) : (
            <PreClassPortrait stage={stage} startsAt={state.startTime} prompt={prompt} notes={state.notes} />
          )
        ) : (
          <MainStage stage={stage} notes={state.notes} isLandscape={isLandscape} />
        )}
      </div>
    </div>
  );
}

/* --------------------------- Main class stage --------------------------- */

function MainStage({
  stage,
  notes,
  isLandscape,
}: {
  stage: StageInfo;
  notes: string;
  isLandscape: boolean;
}) {
  const hasNotes = !!notes.trim();
  const notesTone = stage.fg === "dark" ? "text-neutral-900/85" : "text-white/85";

  // In landscape wide, put notes to the right of timer if notes exist.
  if (isLandscape && hasNotes) {
    return (
      <div className="grid h-full w-full max-w-[1800px] items-center gap-[clamp(1rem,4vw,4rem)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <TimerBlock stage={stage} compact />
        <NotesPanel notes={notes} tone={notesTone} fg={stage.fg} />
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[95vw] flex-col items-center justify-center gap-[clamp(0.5rem,2vmin,2rem)] text-center">
      <TimerBlock stage={stage} />
      {hasNotes && <Notes notes={notes} tone={notesTone} />}
    </div>
  );
}

function TimerBlock({ stage, compact = false }: { stage: StageInfo; compact?: boolean }) {
  const showTimer = stage.phase !== "complete" && stage.phase !== "idle";
  const timerSize = compact
    ? "clamp(4rem, 20vmin, 22rem)"
    : "clamp(5rem, 30vmin, 40rem)";
  const labelSize = compact
    ? "clamp(0.7rem, 1.3vw, 1.4rem)"
    : "clamp(0.8rem, 1.8vw, 1.8rem)";

  return (
    <div className="flex flex-col items-center justify-center gap-[clamp(0.4rem,1.6vmin,1.6rem)] text-center">
      {stage.label && (
        <div
          key={stage.label}
          className="sd-fade font-medium uppercase opacity-80"
          style={{ fontSize: labelSize, letterSpacing: "0.32em" }}
        >
          {stage.label}
        </div>
      )}
      {showTimer && (
        <div
          className={`sd-fade font-mono font-bold leading-none tabular-nums ${stage.blink ? "sd-blink" : ""}`}
          style={{
            fontSize: timerSize,
            letterSpacing: "-0.04em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatMMSS(stage.timerMs)}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Pre-class layouts --------------------------- */

function PreClassLandscape({
  stage,
  startsAt,
  prompt,
  notes,
}: {
  stage: StageInfo;
  startsAt: string;
  prompt: ReturnType<typeof pickPrompt>;
  notes: string;
}) {
  return (
    <div className="grid h-full w-full max-w-[1800px] items-center gap-[clamp(1.5rem,4vw,4rem)] md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Left: countdown timer */}
      <div className="flex flex-col items-center justify-center gap-[clamp(0.5rem,1.4vmin,1.4rem)] text-center">
        <div
          className="font-medium uppercase opacity-80"
          style={{ fontSize: "clamp(0.7rem, 1.2vw, 1.35rem)", letterSpacing: "0.32em" }}
        >
          Class starts in
        </div>
        <div
          className="font-mono font-bold leading-none tabular-nums"
          style={{
            fontSize: "clamp(4.5rem, 20vmin, 22rem)",
            letterSpacing: "-0.04em",
          }}
        >
          {formatMMSS(stage.timerMs)}
        </div>
        <div
          className="mt-[clamp(0.25rem,0.8vmin,1rem)] opacity-60"
          style={{ fontSize: "clamp(0.75rem, 1vw, 1.1rem)", letterSpacing: "0.08em" }}
        >
          Starts at {startsAt}
        </div>
      </div>

      {/* Right: rotating icebreaker prompt */}
      <PromptPanel prompt={prompt} notes={notes} />
    </div>
  );
}

function PreClassPortrait({
  stage,
  startsAt,
  prompt,
  notes,
}: {
  stage: StageInfo;
  startsAt: string;
  prompt: ReturnType<typeof pickPrompt>;
  notes: string;
}) {
  return (
    <div className="flex w-full max-w-[95vw] flex-col items-center justify-center gap-[clamp(0.75rem,2.5vmin,2.5rem)] text-center">
      <div
        className="font-medium uppercase opacity-80"
        style={{ fontSize: "clamp(0.7rem, 2.2vw, 1.4rem)", letterSpacing: "0.32em" }}
      >
        Class starts in
      </div>
      <div
        className="font-mono font-bold leading-none tabular-nums"
        style={{ fontSize: "clamp(5rem, 26vmin, 22rem)", letterSpacing: "-0.04em" }}
      >
        {formatMMSS(stage.timerMs)}
      </div>
      <div className="opacity-60" style={{ fontSize: "clamp(0.75rem, 1.6vw, 1.1rem)" }}>
        Starts at {startsAt}
      </div>
      <div className="w-full max-w-[42rem] px-[clamp(0.5rem,2vw,2rem)]">
        <PromptInline prompt={prompt} />
      </div>
      {notes.trim() && (
        <Notes notes={notes} tone="text-white/80" />
      )}
    </div>
  );
}

function PromptPanel({
  prompt,
  notes,
}: {
  prompt: ReturnType<typeof pickPrompt>;
  notes: string;
}) {
  return (
    <div
      className="flex h-full flex-col justify-center gap-[clamp(0.75rem,1.8vmin,1.75rem)] pl-[clamp(0.5rem,2vw,2.5rem)]"
      style={{ borderLeft: "1px solid rgba(255,255,255,0.14)" }}
    >
      <div>
        <div
          className="font-semibold uppercase text-indigo-300"
          style={{ fontSize: "clamp(0.7rem, 0.95vw, 1rem)", letterSpacing: "0.24em" }}
        >
          <Sparkles className="mr-2 inline h-[1em] w-[1em]" />
          {CATEGORY_LABEL[prompt.category]}
        </div>
        <div
          key={prompt.text}
          className="sd-fade mt-[clamp(0.75rem,1.2vmin,1.25rem)] font-semibold leading-[1.1]"
          style={{ fontSize: "clamp(1.75rem, 3.6vw, 4rem)", letterSpacing: "-0.02em" }}
        >
          {prompt.text}
        </div>
      </div>
      {notes.trim() && (
        <div
          className="leading-snug text-white/70"
          style={{ fontSize: "clamp(0.9rem, 1.2vw, 1.35rem)", maxWidth: "56ch" }}
        >
          {notes}
        </div>
      )}
    </div>
  );
}

function PromptInline({ prompt }: { prompt: ReturnType<typeof pickPrompt> }) {
  return (
    <div className="text-center">
      <div
        className="font-semibold uppercase text-indigo-300"
        style={{ fontSize: "clamp(0.65rem, 1.5vw, 0.9rem)", letterSpacing: "0.24em" }}
      >
        {CATEGORY_LABEL[prompt.category]}
      </div>
      <div
        key={prompt.text}
        className="sd-fade mt-[clamp(0.5rem,1.2vmin,1rem)] font-semibold leading-[1.15]"
        style={{ fontSize: "clamp(1.4rem, 5vw, 3rem)", letterSpacing: "-0.02em" }}
      >
        {prompt.text}
      </div>
    </div>
  );
}

/* --------------------------- Cinematic countdown --------------------------- */

function CountdownCinematic({ n }: { n: number }) {
  return (
    <div className="flex flex-col items-center justify-center">
      <div
        key={n}
        className="sd-countdown font-mono font-bold leading-none tabular-nums"
        style={{ fontSize: "clamp(10rem, 55vmin, 60rem)", letterSpacing: "-0.05em" }}
      >
        {n}
      </div>
    </div>
  );
}

/* --------------------------- Notes --------------------------- */

function Notes({ notes, tone }: { notes: string; tone: string }) {
  return (
    <div
      className={`sd-fade mx-auto max-w-[52ch] whitespace-pre-wrap text-center leading-snug ${tone}`}
      style={{ fontSize: "clamp(0.95rem, 1.6vw, 1.6rem)" }}
    >
      {notes}
    </div>
  );
}

function NotesPanel({
  notes,
  tone,
  fg,
}: {
  notes: string;
  tone: string;
  fg: "light" | "dark";
}) {
  const border = fg === "dark" ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.14)";
  return (
    <div
      className={`flex h-full flex-col justify-center pl-[clamp(0.75rem,2vw,2.5rem)] ${tone}`}
      style={{ borderLeft: `1px solid ${border}` }}
    >
      <div
        className="whitespace-pre-wrap leading-snug"
        style={{ fontSize: "clamp(1rem, 1.6vw, 1.75rem)", maxWidth: "44ch" }}
      >
        {notes}
      </div>
    </div>
  );
}
