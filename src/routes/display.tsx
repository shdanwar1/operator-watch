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

import { pickIcebreaker } from "@/lib/icebreakers";
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

/**
 * Measures the display surface and derives orientation from real pixels.
 * Portrait when height > width * 1.15, landscape when width > height * 1.15;
 * near-square prefers the stacked (portrait) composition.
 */
function useAspect() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>(() =>
    typeof window === "undefined"
      ? { w: 0, h: 0 }
      : { w: window.innerWidth, h: window.innerHeight },
  );
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setSize((p) => (p.w === w && p.h === h ? p : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { w, h } = size;
  // Single orientation threshold for the whole display — every stage reads
  // this one value, so no two panels can disagree about the layout.
  // Wider than tall => landscape (side-by-side); otherwise stacked.
  const isLandscape = w > 0 && h > 0 ? w >= h : false;
  return { ref, isLandscape, isPortrait: !isLandscape, width: w, height: h };
}

/**
 * Layout capacity check for the optional pre-class ice-breaker.
 * Priority 1 is the countdown; the ice-breaker is dropped only when the
 * measured surface genuinely cannot hold both at a readable size.
 * `showing` provides hysteresis so a resize near the threshold can't flicker.
 */
function shouldShowIcebreaker({
  width,
  height,
  isLandscape,
  showing,
}: {
  width: number;
  height: number;
  isLandscape: boolean;
  showing: boolean;
}) {
  if (width <= 0 || height <= 0) return showing;
  const slack = showing ? 0.9 : 1; // keep visible slightly past the hide point
  if (isLandscape) {
    // Side-by-side: each half needs enough width, timer needs some height.
    return width >= 720 * slack && height >= 300 * slack;
  }
  // Stacked: vertical space is the binding constraint (timer + rule + text).
  return height >= 520 * slack && width >= 340 * slack;
}


function useIcebreakerVisible(width: number, height: number, isLandscape: boolean) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible((prev) => {
      const next = shouldShowIcebreaker({ width, height, isLandscape, showing: prev });
      return next === prev ? prev : next;
    });
  }, [width, height, isLandscape]);
  return visible;
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
  const { ref, isLandscape, width: surfaceW, height: surfaceH } = useAspect();
  const icebreakerVisible = useIcebreakerVisible(surfaceW, surfaceH, isLandscape);


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
    <>
      <SurfaceChrome color={stage.bgColor} />
    <div ref={ref} className={`fixed inset-0 overflow-hidden ${textClass}`}>

      <div
        aria-hidden
        className={`absolute inset-0 ${stage.pulse && stage.phase === "final30" ? "sd-pulse-bg" : ""}`}
        style={{
          backgroundColor: stage.bgColor,
          transition: "background-color 10000ms cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "background-color",
        }}
      >
        {/* Same semantic colour, just a touch of vertical tone so large flat
            fields don't read as a dead screen. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              stage.fg === "dark"
                ? "linear-gradient(to bottom, rgba(255,255,255,0.06), rgba(0,0,0,0.05))"
                : "linear-gradient(to bottom, rgba(255,255,255,0.05), rgba(0,0,0,0.10))",
          }}
        />
      </div>

      <div
        className="sd-display-surface relative z-10 flex h-full w-full items-center justify-center"
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
          <PreClassStage
            stage={stage}
            startsAt={state.startTime}
            isLandscape={isLandscape}
            showIcebreaker={icebreakerVisible}
          />


        ) : (
          <MainStage stage={stage} notes={state.notes} isLandscape={isLandscape} />
        )}
      </div>
    </div>
    </>
  );
}

/**
 * Paints the browser chrome (title bar / status bar / overscroll) with the
 * current stage colour so the window frame never lags behind the screen.
 */
function SurfaceChrome({ color }: { color: string }) {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      html: html.style.backgroundColor,
      body: body.style.backgroundColor,
      htmlTransition: html.style.transition,
      bodyTransition: body.style.transition,
    };
    const transition = "background-color 10000ms cubic-bezier(0.4, 0, 0.2, 1)";
    html.style.transition = transition;
    body.style.transition = transition;
    html.style.backgroundColor = color;
    body.style.backgroundColor = color;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    let created = false;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
      created = true;
    }
    const prevContent = meta.content;
    meta.content = color;

    return () => {
      html.style.backgroundColor = prev.html;
      body.style.backgroundColor = prev.body;
      html.style.transition = prev.htmlTransition;
      body.style.transition = prev.bodyTransition;
      if (created) meta?.remove();
      else if (meta) meta.content = prevContent;
    };
  }, [color]);
  return null;
}


/* --------------------------- Shared type primitives --------------------------- */

/** Small tracked uppercase label — the one label voice for every screen. */
function StageLabel({
  children,
  size = "clamp(0.62rem, 1.1vmin, 1.05rem)",
  tracking = "0.34em",
  opacity = 0.55,
  className = "",
  style,
}: {
  children: React.ReactNode;
  size?: string;
  tracking?: string;
  opacity?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`font-medium uppercase ${className}`}
      style={{
        fontSize: size,
        letterSpacing: tracking,
        opacity,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The single numeric face shared by every timer on every screen (SF Pro). */
function TimerDigits({
  value,
  size,
  weight = 300,
  tracking = "-0.035em",
  className = "",
}: {
  value: string | number;
  size: string;
  weight?: number;
  tracking?: string;
  className?: string;
}) {
  return (
    <div
      className={`sd-num leading-none ${className}`}
      style={{
        fontSize: size,
        fontWeight: weight,
        letterSpacing: tracking,
        whiteSpace: "nowrap",
        maxWidth: "100%",
      }}
    >
      {value}
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
      className={`grid h-full w-full max-w-[1800px] items-center gap-[clamp(1.25rem,4vw,4.5rem)] ${
        isLandscape ? "grid-cols-[minmax(0,1.35fr)_1px_minmax(0,1fr)]" : "grid-cols-1"
      }`}
    >
      {/* Class identity */}
      <div className="flex min-w-0 flex-col justify-center gap-[clamp(0.4rem,1.4vmin,1.25rem)] text-left">
        <div aria-hidden className="sd-rule-h h-px w-[clamp(2.5rem,6vw,6rem)]" />
        <StageLabel opacity={0.5}>Up next</StageLabel>
        <div
          className="font-semibold leading-[1.02]"
          style={{ fontSize: "clamp(2rem, 7vmin, 6rem)", letterSpacing: "-0.032em" }}
        >
          {className || "Class"}
        </div>
        {teacherName && (
          <div
            className="font-normal opacity-70"
            style={{ fontSize: "clamp(1rem, 2.5vmin, 2.1rem)", letterSpacing: "-0.01em" }}
          >
            {teacherName}
          </div>
        )}
        <div
          className="mt-[clamp(0.35rem,1.2vmin,1.2rem)] flex flex-wrap items-center gap-[clamp(0.5rem,1.2vw,1rem)] opacity-45"
          style={{ fontSize: "clamp(0.68rem, 1vw, 1rem)", letterSpacing: "0.14em" }}
        >
          <span className="sd-num">{startsAt}</span>
          <span aria-hidden>·</span>
          <span className="sd-num">{durationMin} MIN</span>
        </div>
      </div>

      {isLandscape ? (
        <div aria-hidden className="sd-rule-v h-[62%] w-px" />
      ) : (
        <div aria-hidden className="sd-rule-h h-px w-full" />
      )}

      {/* Countdown */}
      <div
        className={`flex flex-col justify-center gap-[clamp(0.35rem,1.2vmin,1rem)] ${
          isLandscape ? "items-end text-right" : "items-center text-center"
        }`}
      >
        <StageLabel opacity={0.5} size="clamp(0.6rem, 1vmin, 1rem)">
          Class starts in
        </StageLabel>
        <TimerDigits
          value={formatMMSS(stage.timerMs)}
          size="clamp(3rem, 15vmin, 15rem)"
          weight={250}
          tracking="-0.04em"
          className="opacity-95"
        />
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

  if (stage.phase === "idle") return <IdleStage label={stage.label} />;

  if (isLandscape && hasNotes) {
    return (
      <div className="grid h-full w-full max-w-[1800px] grid-cols-[minmax(0,1.15fr)_1px_minmax(0,1fr)] items-center gap-[clamp(1.25rem,4vw,4.5rem)]">
        <TimerBlock stage={stage} compact />
        <div aria-hidden className="sd-rule-v h-[58%] w-px" />
        <NotesPanel notes={notes} />
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[95vw] flex-col items-center justify-center gap-[clamp(0.75rem,2.4vmin,2.25rem)] text-center">
      <TimerBlock stage={stage} />
      {hasNotes && (
        <>
          <div aria-hidden className="sd-rule-h h-px w-[min(78%,40rem)]" />
          <Notes notes={notes} />
        </>
      )}
    </div>
  );
}

function TimerBlock({ stage, compact = false }: { stage: StageInfo; compact?: boolean }) {
  const timerSize = compact
    ? "clamp(4rem, 19vmin, 21rem)"
    : "clamp(5rem, 28vmin, 36rem)";
  const labelSize = compact
    ? "clamp(0.66rem, 1.2vmin, 1.2rem)"
    : "clamp(0.72rem, 1.5vmin, 1.5rem)";

  // Urgency is carried by type weight and label presence, not extra chrome.
  const urgent = stage.phase === "warn1" || stage.phase === "final30";

  return (
    <div className="flex flex-col items-center justify-center gap-[clamp(0.5rem,1.8vmin,1.75rem)] text-center">
      {stage.label && (
        <StageLabel
          key={stage.label}
          className="sd-fade"
          size={labelSize}
          tracking={urgent ? "0.26em" : "0.34em"}
          opacity={urgent ? 0.9 : 0.65}
        >
          {stage.label}
        </StageLabel>
      )}
      <TimerDigits
        value={formatMMSS(stage.timerMs)}
        size={timerSize}
        weight={urgent ? 400 : 250}
        tracking="-0.04em"
        className={stage.blink ? "sd-blink" : ""}
      />
    </div>
  );
}

/* --------------------------- Idle --------------------------- */

function IdleStage({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-[clamp(1rem,3vmin,2.25rem)]">
      <span
        aria-hidden
        className="sd-breathe block rounded-full bg-current"
        style={{ width: "6px", height: "6px" }}
      />
      <StageLabel opacity={0.45}>{label || "Waiting for Next Class"}</StageLabel>
    </div>
  );
}

/* --------------------------- Pre-class (minimal, Apple-inspired) --------------------------- */

function PreClassStage({
  stage,
  startsAt,
  isLandscape,
  showIcebreaker = true,
}: {
  stage: StageInfo;
  startsAt: string;
  isLandscape: boolean;
  showIcebreaker?: boolean;
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

  // Not enough room for the supplementary content: the timer takes the whole
  // surface and re-centres — no divider, no empty column, no clipped text.
  if (!showIcebreaker) {
    return (
      <div className="flex h-full w-full min-h-0 min-w-0 items-center justify-center px-[clamp(1rem,5vw,4rem)]">
        <PreClassTimer stage={stage} startsAt={startsAt} portrait={!isLandscape} />
      </div>
    );
  }

  if (isLandscape) {
    return (
      <div className="h-full w-full min-h-0 min-w-0">
      <div className="relative grid h-full w-full grid-cols-2">
        {/* Left panel: timer, centered within its own half */}
        <div className="flex min-w-0 items-center justify-center px-[clamp(1rem,3vw,4rem)]">
          <PreClassTimer stage={stage} startsAt={startsAt} />
        </div>
        {/* Subtle divider at exactly 50% */}
        <div
          aria-hidden
          className="sd-rule-v pointer-events-none absolute inset-y-[12%] left-1/2 w-px"
        />
        {/* Right panel: one ice-breaker */}
        <div className="flex min-w-0 items-center justify-start overflow-hidden px-[clamp(1.5rem,4vw,5rem)]">
          <IcebreakerLine tip={tip} fadeKey={fadeKey} />
        </div>
      </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full min-h-0 min-w-0">
      <div className="flex h-full w-full flex-col items-center justify-center gap-[clamp(1rem,3vh,2.5rem)] overflow-hidden">
        <div className="flex min-h-0 w-full flex-[1.1] items-center justify-center px-[clamp(1rem,6vw,3rem)]">
          <PreClassTimer stage={stage} startsAt={startsAt} portrait />
        </div>
        <div aria-hidden className="sd-rule-h h-px w-[min(88%,44rem)] shrink-0" />
        <div className="flex min-h-0 w-full flex-1 items-start justify-center overflow-hidden px-[clamp(1.5rem,6vw,3rem)] pt-[clamp(0.75rem,3vh,2rem)]">
          <IcebreakerLine tip={tip} fadeKey={fadeKey} centered />
        </div>
      </div>
    </div>

  );
}

function PreClassTimer({
  stage,
  startsAt,
  portrait = false,
}: {
  stage: StageInfo;
  startsAt: string;
  portrait?: boolean;
}) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-[clamp(0.5rem,1.6vmin,1.6rem)] text-center">
      <StageLabel
        opacity={0.5}
        size={portrait ? "clamp(0.6rem, 2.4vw, 1.2rem)" : "clamp(0.66rem, 1.1vw, 1.2rem)"}
        tracking={portrait ? "clamp(0.08em, 0.9vw, 0.36em)" : "0.36em"}
      >
        Class starts in
      </StageLabel>
      <TimerDigits
        value={formatMMSS(stage.timerMs)}
        size={
          portrait
            ? "clamp(2.75rem, min(20vw, 18vh), 12rem)"
            : "clamp(3.5rem, 15vmin, 18rem)"
        }
        weight={200}
        tracking="-0.045em"
      />
      <div
        className="mt-[clamp(0.2rem,0.8vmin,0.9rem)] opacity-40"
        style={{
          fontSize: portrait ? "clamp(0.68rem, 2.1vw, 1rem)" : "clamp(0.68rem, 0.9vw, 1rem)",
          letterSpacing: "0.12em",
          whiteSpace: "nowrap",
        }}
      >
        Starts at <span className="sd-num">{startsAt}</span>
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
    <div
      key={fadeKey}
      className={`sd-rise ${centered ? "mx-auto max-w-[36ch] text-center" : "max-w-[26ch] text-left"}`}
    >
      <StageLabel
        opacity={0.4}
        size={centered ? "clamp(0.58rem, 2vw, 0.95rem)" : "clamp(0.58rem, 0.85vw, 0.95rem)"}
        tracking="0.34em"
        className={centered ? "mb-[clamp(0.6rem,1.6vh,1.2rem)]" : "mb-[clamp(0.6rem,1.4vmin,1.2rem)]"}
      >
        Ice breaker
      </StageLabel>
      <p
        className="font-light opacity-90"
        style={{
          fontSize: centered ? "clamp(1rem, 3.6vw, 1.9rem)" : "clamp(1rem, 1.7vw, 2rem)",
          lineHeight: 1.35,
          letterSpacing: "-0.015em",
          wordBreak: "normal",
          overflowWrap: "normal",
        }}
      >
        {tip}
      </p>
    </div>
  );
}


/* --------------------------- Cinematic countdown --------------------------- */

function CountdownCinematic({ n }: { n: number }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div aria-hidden className="sd-vignette pointer-events-none absolute inset-0" />
      <TimerDigits
        key={n}
        value={n}
        size="min(62vmin, 80vh)"
        weight={200}
        tracking="-0.06em"
        className="sd-countdown relative"
      />
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
          className="pointer-events-none absolute left-1/2 -translate-x-1/2"
          style={{ bottom: "clamp(1.5rem, 4vh, 3rem)" }}
        >
          <StageLabel opacity={0.4} size="clamp(0.6rem, 1.4vmin, 1rem)" tracking="0.28em">
            Questions &amp; Discussion
          </StageLabel>
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

  const labelText =
    mode === "full" ? "Class Complete" : mode === "compact" ? "Q&A" : "Q & A";

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
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={0.4} />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.92)"
          strokeWidth={0.9}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C - dash}`}
          style={{ transition: "stroke-dasharray 900ms cubic-bezier(0.4, 0, 0.2, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[4cqi]">
        <div className="flex items-center gap-[2cqi]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-45"
            style={{ width: "3.6cqi", height: "3.6cqi" }}
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <StageLabel
            opacity={0.6}
            size={`clamp(0.6rem, ${mode === "full" ? "2.4cqi" : "2.9cqi"}, 1.15rem)`}
            tracking={mode === "compact" ? "0.16em" : "0.34em"}
          >
            {labelText}
          </StageLabel>
        </div>
        <TimerDigits value={label} size="clamp(2rem, 21cqi, 10rem)" weight={200} tracking="-0.03em" />
      </div>
    </div>
  );
}

/* --------------------------- Notes --------------------------- */

function Notes({ notes }: { notes: string }) {
  return (
    <div
      className="sd-fade mx-auto max-w-[52ch] whitespace-pre-wrap text-center font-light opacity-85"
      style={{ fontSize: "clamp(0.95rem, 1.6vw, 1.6rem)", lineHeight: 1.5 }}
    >
      {notes}
    </div>
  );
}

function NotesPanel({ notes }: { notes: string }) {
  return (
    <div className="flex h-full flex-col justify-center">
      <div
        className="whitespace-pre-wrap font-light opacity-85"
        style={{ fontSize: "clamp(1rem, 1.6vw, 1.75rem)", lineHeight: 1.5, maxWidth: "44ch" }}
      >
        {notes}
      </div>
    </div>
  );
}

