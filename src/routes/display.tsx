import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStudioDisplay } from "@/hooks/useStudioDisplay";
import {
  computeStage,
  formatMMSS,
  resolveClassStart,
  QA_MS,
  CLASS_INFO_CUTOFF_MS,
  type StageInfo,
} from "@/lib/studio-display";

import { pickPromptSet, type Prompt } from "@/lib/icebreakers";
import { subscribeSync } from "@/lib/sync-bus";

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

function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

function DisplayScreen() {
  const { state: shared, ready } = useStudioDisplay("display");
  useTicker(250);
  const { ref, isLandscape } = useAspect();

  // A class-specific display is opened with ?c=&t=&s=&d= — no manual setup.
  const [override, setOverride] = useState<{
    className: string;
    teacherName: string;
    startTime: string;
    durationMin: number;
  } | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get("s");
    setClassId(p.get("id"));
    if (!s) return;
    setOverride({
      className: p.get("c") ?? "",
      teacherName: p.get("t") ?? "",
      startTime: s,
      durationMin: Math.max(1, parseInt(p.get("d") ?? "60", 10) || 60),
    });
  }, []);

  // A Google Calendar sync can move or rename this class; the display picks
  // the new values up live instead of showing stale information.
  useEffect(() => {
    if (!classId) return;
    return subscribeSync((msg) => {
      if (msg.type !== "class-display") return;
      const fresh = msg.classes.find((c) => c.id === classId);
      if (!fresh) return;
      setOverride({
        className: fresh.className,
        teacherName: fresh.teacherName,
        startTime: fresh.startTime,
        durationMin: Math.max(1, fresh.durationMin),
      });
    });
  }, [classId]);

  if (!ready) return null;

  const state = override
    ? {
        ...shared,
        startTime: override.startTime,
        durationMin: override.durationMin,
        className: override.className,
        teacherName: override.teacherName,
        timerMode: "next" as const,
      }
    : shared;

  const now = new Date();
  const stage = computeStage(state, now);
  const startAt = resolveClassStart(state, now);
  const untilStart = startAt.getTime() - now.getTime();

  const hasClassInfo = !!(state.className?.trim() || state.teacherName?.trim());
  // Class name + teacher until exactly 5 minutes before start, then the
  // existing countdown interface takes over unchanged.
  const showClassInfo =
    hasClassInfo && stage.phase === "before" && untilStart > CLASS_INFO_CUTOFF_MS;

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
        {showClassInfo ? (
          <ClassInfoStage
            className={state.className ?? ""}
            teacherName={state.teacherName ?? ""}
            stage={stage}
            startsAt={state.startTime}
            durationMin={state.durationMin}
            isLandscape={isLandscape}
          />
        ) : stage.phase === "countdown10" ? (
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

/* --------------------------- Class information banner --------------------------- */

function ClassInfoStage({
  className,
  teacherName,
  stage,
  startsAt,
  durationMin,
  isLandscape,
}: {
  className: string;
  teacherName: string;
  stage: StageInfo;
  startsAt: string;
  durationMin: number;
  isLandscape: boolean;
}) {
  return (
    <div
      className={`grid h-full w-full max-w-[1800px] items-center gap-[clamp(1rem,4vw,4rem)] ${
        isLandscape ? "md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" : ""
      }`}
    >
      <div className="flex flex-col justify-center gap-[clamp(0.5rem,1.6vmin,1.5rem)] text-left">
        <div
          className="font-medium uppercase text-white/50"
          style={{ fontSize: "clamp(0.65rem, 1.1vw, 1.1rem)", letterSpacing: "0.36em" }}
        >
          Up next
        </div>
        <div
          className="font-semibold leading-[1.05]"
          style={{ fontSize: "clamp(2rem, 7vmin, 6rem)", letterSpacing: "-0.03em" }}
        >
          {className || "Class"}
        </div>
        {teacherName && (
          <div
            className="font-medium text-white/70"
            style={{ fontSize: "clamp(1rem, 2.6vmin, 2.2rem)" }}
          >
            {teacherName}
          </div>
        )}
        <div
          className="mt-[clamp(0.4rem,1.4vmin,1.4rem)] flex flex-wrap items-center gap-[clamp(0.75rem,2vw,2rem)] text-white/45"
          style={{ fontSize: "clamp(0.7rem, 1.1vw, 1.05rem)", letterSpacing: "0.14em" }}
        >
          <span>{startsAt}</span>
          <span>{durationMin} MIN</span>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-[clamp(0.4rem,1.4vmin,1.2rem)] text-center md:items-end md:text-right">
        <div
          className="font-medium uppercase text-white/50"
          style={{ fontSize: "clamp(0.6rem, 1vw, 1rem)", letterSpacing: "0.34em" }}
        >
          Class starts in
        </div>
        <div
          className="font-mono font-semibold leading-none tabular-nums"
          style={{ fontSize: "clamp(3rem, 16vmin, 16rem)", letterSpacing: "-0.05em" }}
        >
          {formatMMSS(stage.timerMs)}
        </div>
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
  // One rotating ice-breaker, refreshed every 15s
  const [tip, setTip] = useState<string>(() => pickIcebreaker());
  const [fadeKey, setFadeKey] = useState(0);

  useEffect(() => {
    const tick = () => {
      setTip(pickIcebreaker());
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
      <div className="relative grid h-full w-full grid-cols-2">
        {/* Left panel: timer, centered within its own half */}
        <div className="flex items-center justify-center px-[clamp(1rem,3vw,4rem)]">
          <PreClassTimer stage={stage} startsAt={startsAt} />
        </div>
        {/* Subtle divider at exactly 50% */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px"
          style={{ background: "rgba(255,255,255,0.12)" }}
        />
        {/* Right panel: one ice-breaker */}
        <div className="flex items-center justify-start px-[clamp(1.5rem,4vw,5rem)]">
          <IcebreakerLine tip={tip} fadeKey={fadeKey} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[95vw] flex-col items-center justify-center gap-[clamp(1.25rem,4vmin,3rem)] text-center">
      <PreClassTimer stage={stage} startsAt={startsAt} />
      <IcebreakerLine tip={tip} fadeKey={fadeKey} centered />
    </div>
  );
}

function PreClassTimer({ stage, startsAt }: { stage: StageInfo; startsAt: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-[clamp(0.5rem,1.4vmin,1.4rem)] text-center">
      <div
        className="font-medium uppercase opacity-70"
        style={{ fontSize: "clamp(0.7rem, 1.2vw, 1.35rem)", letterSpacing: "0.36em" }}
      >
        Class starts in
      </div>
      <div
        className="font-mono font-semibold leading-none tabular-nums"
        style={{
          fontSize: "clamp(3.5rem, 15vmin, 18rem)",
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

function IcebreakerLine({
  tip,
  fadeKey,
  centered = false,
}: {
  tip: string;
  fadeKey: number;
  centered?: boolean;
}) {
  return (
    <p
      key={fadeKey}
      className={`sd-fade leading-snug ${centered ? "text-center" : "text-left"}`}
      style={{ fontSize: "clamp(0.95rem, 1.5vw, 1.75rem)", letterSpacing: "-0.01em" }}
    >
      <span className="font-medium text-white/45">Tips to break the ice: </span>
      <span className="font-medium text-white/90">&ldquo;{tip}&rdquo;</span>
    </p>
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
  const { ref, size } = useSize<HTMLDivElement>();
  const viewport = Math.min(size.width, size.height);

  const mode: QAMode = viewport < 360 ? "minimal" : viewport < 600 ? "compact" : "full";

  return (
    <div ref={ref} className="relative flex h-full w-full items-center justify-center">
      <CircularTimer progress={progress} label={formatMMSS(stage.timerMs)} mode={mode} />
      {mode === "full" && (
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
      )}
    </div>
  );
}

type QAMode = "full" | "compact" | "minimal";

function CircularTimer({
  progress,
  label,
  mode = "full",
}: {
  progress: number;
  label: string;
  mode?: QAMode;
}) {
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
        {mode === "full" && (
          <div
            className="font-light uppercase text-white/85"
            style={{ fontSize: "clamp(0.6rem, 2.4cqi, 1.1rem)", letterSpacing: "0.38em" }}
          >
            Class Complete
          </div>
        )}
        {mode === "compact" && (
          <div
            className="font-light uppercase text-white/85"
            style={{ fontSize: "clamp(0.65rem, 2.8cqi, 1.15rem)", letterSpacing: "0.12em" }}
          >
            Q&amp;A
          </div>
        )}
        {mode === "minimal" && (
          <div
            className="font-light uppercase text-white/85"
            style={{ fontSize: "clamp(0.6rem, 3.2cqi, 1.2rem)", letterSpacing: "0.3em" }}
          >
            Q &amp; A
          </div>
        )}
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
