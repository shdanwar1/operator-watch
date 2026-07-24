import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStudioDisplay } from "@/hooks/useStudioDisplay";
import {
  computeStage,
  formatMMSS,
  resolveStartAt,
  QA_MS,
  type StageInfo,
} from "@/lib/studio-display";
import { pickPromptSet, type Prompt } from "@/lib/icebreakers";

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

  const textClass = stage.fg === "dark" ? "text-neutral-900" : "text-white";

  return (
    <div ref={ref} className={`fixed inset-0 overflow-hidden ${textClass}`}>
      <div
        aria-hidden
        className={`absolute inset-0 ${stage.pulse && stage.phase === "final30" ? "sd-pulse-bg" : ""}`}
        style={{
          backgroundColor: stage.bgColor,
          transition: "background-color 10000ms cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "background-color",
        }}
      />

      <div
        className="relative z-10 flex h-full w-full items-center justify-center"
        style={{ padding: "clamp(0.75rem, 3vmin, 3.5rem)" }}
      >
        {stage.phase === "countdown10" ? (
          <CountdownCinematic n={stage.bigNumber ?? 1} />
        ) : stage.phase === "qa" ? (
          <QAStage stage={stage} />
        ) : showPreClass ? (
          <PreClassStage stage={stage} startsAt={state.startTime} isLandscape={isLandscape} />
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

/* --------------------------- Pre-class (minimal, Apple-inspired) --------------------------- */

function PreClassStage({
  stage,
  startsAt,
  isLandscape,
}: {
  stage: StageInfo;
  startsAt: string;
  isLandscape: boolean;
}) {
  // Rotating trio of prompts, refreshed every 15s
  const [prompts, setPrompts] = useState<Prompt[]>(() => pickPromptSet());
  const [fadeKey, setFadeKey] = useState(0);

  useEffect(() => {
    const tick = () => {
      setPrompts(pickPromptSet());
      setFadeKey((k) => k + 1);
    };
    const now = Date.now();
    const nextSlot = 15_000 - (now % 15_000);
    let interval: ReturnType<typeof setInterval> | null = null;
    const initial = setTimeout(() => {
      tick();
      interval = setInterval(tick, 15_000);
    }, nextSlot);
    return () => {
      clearTimeout(initial);
      if (interval) clearInterval(interval);
    };
  }, []);

  if (isLandscape) {
    return (
      <div className="grid h-full w-full max-w-[1900px] items-center gap-[clamp(1.5rem,5vw,5rem)] md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        {/* Left ~70%: timer */}
        <PreClassTimer stage={stage} startsAt={startsAt} align="right" />
        {/* Right ~30%: 3 subtle prompts */}
        <PromptList prompts={prompts} fadeKey={fadeKey} />
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[95vw] flex-col items-center justify-center gap-[clamp(1.25rem,4vmin,3rem)] text-center">
      <PreClassTimer stage={stage} startsAt={startsAt} align="center" />
      <PromptList prompts={prompts} fadeKey={fadeKey} centered />
    </div>
  );
}

function PreClassTimer({
  stage,
  startsAt,
  align,
}: {
  stage: StageInfo;
  startsAt: string;
  align: "right" | "center";
}) {
  const alignCls =
    align === "right"
      ? "items-center md:items-end text-center md:text-right md:pr-[clamp(1rem,3vw,3rem)]"
      : "items-center text-center";
  return (
    <div className={`flex flex-col justify-center gap-[clamp(0.5rem,1.4vmin,1.4rem)] ${alignCls}`}>
      <div
        className="font-medium uppercase opacity-70"
        style={{ fontSize: "clamp(0.7rem, 1.2vw, 1.35rem)", letterSpacing: "0.36em" }}
      >
        Class starts in
      </div>
      <div
        className="font-mono font-semibold leading-none tabular-nums"
        style={{
          fontSize: "clamp(4.5rem, 22vmin, 24rem)",
          letterSpacing: "-0.05em",
        }}
      >
        {formatMMSS(stage.timerMs)}
      </div>
      <div
        className="mt-[clamp(0.25rem,0.8vmin,1rem)] opacity-50"
        style={{ fontSize: "clamp(0.7rem, 0.95vw, 1.05rem)", letterSpacing: "0.12em" }}
      >
        Starts at {startsAt}
      </div>
    </div>
  );
}

function PromptList({
  prompts,
  fadeKey,
  centered = false,
}: {
  prompts: Prompt[];
  fadeKey: number;
  centered?: boolean;
}) {
  // ~25% of timer size — keep subtle
  const size = "clamp(0.9rem, 1.4vw, 1.6rem)";
  return (
    <div
      key={fadeKey}
      className={`sd-fade flex flex-col justify-center gap-[clamp(0.9rem,2.4vmin,2rem)] ${
        centered ? "items-center text-center" : "items-start text-left"
      }`}
    >
      {prompts.map((p, i) => (
        <div
          key={`${fadeKey}-${i}`}
          className="flex items-baseline gap-[clamp(0.5rem,0.9vw,1rem)] leading-snug text-white/85"
          style={{ fontSize: size, letterSpacing: "-0.01em" }}
        >
          <span aria-hidden style={{ fontSize: "1.15em", lineHeight: 1 }}>
            {p.emoji}
          </span>
          <span className="font-medium">{p.text}</span>
        </div>
      ))}
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

/* --------------------------- Q&A post-class --------------------------- */

function QAStage({ stage }: { stage: StageInfo }) {
  const total = stage.totalMs ?? QA_MS;
  const progress = Math.max(0, Math.min(1, stage.timerMs / total));

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <CircularTimer progress={progress} label={formatMMSS(stage.timerMs)} />
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 font-medium uppercase text-white/60"
        style={{
          bottom: "clamp(1.5rem, 4vh, 3rem)",
          fontSize: "clamp(0.65rem, 1.5vmin, 1.1rem)",
          letterSpacing: "0.32em",
        }}
      >
        Questions &amp; Discussion
      </div>
    </div>
  );
}

function CircularTimer({ progress, label }: { progress: number; label: string }) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const dash = C * progress;
  const stroke = 0.6;

  return (
    <div
      className="relative aspect-square"
      style={{
        containerType: "inline-size",
        width: "min(80vmin, 92vw)",
        maxWidth: "100%",
        maxHeight: "100%",
      }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="white"
          strokeWidth={stroke * 1.6}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C - dash}`}
          style={{
            transition: "stroke-dasharray 900ms cubic-bezier(0.4, 0, 0.2, 1)",
            filter: "drop-shadow(0 0 6px rgba(255,255,255,0.55))",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3cqi]">
        <div
          className="font-light uppercase text-white/85"
          style={{ fontSize: "clamp(0.6rem, 2.4cqi, 1.1rem)", letterSpacing: "0.38em" }}
        >
          Class Complete
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: "6cqi", height: "6cqi" }}
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <div
          className="font-light leading-none tabular-nums text-white"
          style={{ fontSize: "clamp(2rem, 22cqi, 10rem)", letterSpacing: "-0.02em" }}
        >
          {label}
        </div>
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
