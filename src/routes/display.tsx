import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clock, Globe, Heart, Lightbulb, Music2, Smile, Sparkles, Sun } from "lucide-react";
import { useStudioDisplay } from "@/hooks/useStudioDisplay";
import { computeStage, formatMMSS, resolveStartAt } from "@/lib/studio-display";
import { pickIcebreaker, type IcebreakerItem } from "@/lib/icebreakers";

export const Route = createFileRoute("/display")({
  component: DisplayScreen,
  head: () => ({
    meta: [
      { title: "Studio Display" },
      { name: "description", content: "Live class timer and notes for the studio." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

// Show the icebreaker panel only when the class is close — within 15 min
// of the scheduled start, or during the 1-minute warm-up window.
const ICEBREAKER_WINDOW_MS = 15 * 60_000;

function DisplayScreen() {
  const { state, ready } = useStudioDisplay("display");
  const [, force] = useState(0);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!ready) return null;

  const now = new Date();
  const stage = computeStage(state, now);
  const hasNotes = !!state.notes.trim();
  const notesTone = stage.phase === "warn5" ? "text-neutral-900/85" : "text-white/85";
  const dividerTone = stage.phase === "warn5" ? "bg-neutral-900/20" : "bg-white/20";

  // Icebreaker panel visibility.
  const startAt = resolveStartAt(state.startTime, now);
  const untilStart = startAt.getTime() - now.getTime();
  const showIcebreaker =
    (stage.phase === "before" && untilStart <= ICEBREAKER_WINDOW_MS) ||
    stage.phase === "warmup";

  const startsAtLabel = state.startTime; // "HH:MM"
  const icebreaker = pickIcebreaker(now);

  return (
    <div className={`fixed inset-0 overflow-hidden ${stage.fg}`}>
      {/* Dedicated background layer — smooth 10s cross-fade between stage colors. */}
      <div
        aria-hidden
        className={`absolute inset-0 ${stage.pulse ? "sd-pulse-bg" : ""}`}
        style={{
          backgroundColor: stage.bgColor,
          transition: "background-color 10s cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "background-color",
        }}
      />

      {/* Content layer */}
      <div
        className="relative z-10 flex h-full w-full items-center justify-center"
        style={{ padding: "clamp(1rem, 4vmin, 4rem)" }}
      >
        {showIcebreaker ? (
          <div className="grid h-full w-full max-w-[1600px] items-center gap-[clamp(1.5rem,4vw,4rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            {/* Left — timer */}
            <TimerBlock
              stage={stage}
              startsAtLabel={startsAtLabel}
              showStartsAt={stage.phase === "before"}
              hasNotes={hasNotes}
              notesTone={notesTone}
              dividerTone={dividerTone}
              notes={state.notes}
              compact
            />
            {/* Right — icebreaker */}
            <IcebreakerPanel
              greeting={icebreaker.greeting}
              items={icebreaker.items}
              tip={icebreaker.tip}
              onYellow={false}
            />
          </div>
        ) : (
          <div className="flex w-full max-w-[92vw] flex-col items-center justify-center gap-[clamp(0.75rem,2vmin,2rem)] text-center">
            <TimerBlock
              stage={stage}
              startsAtLabel={startsAtLabel}
              showStartsAt={false}
              hasNotes={hasNotes}
              notesTone={notesTone}
              dividerTone={dividerTone}
              notes={state.notes}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TimerBlock({
  stage,
  startsAtLabel,
  showStartsAt,
  hasNotes,
  notesTone,
  dividerTone,
  notes,
  compact = false,
}: {
  stage: ReturnType<typeof computeStage>;
  startsAtLabel: string;
  showStartsAt: boolean;
  hasNotes: boolean;
  notesTone: string;
  dividerTone: string;
  notes: string;
  compact?: boolean;
}) {
  const timerSize = compact
    ? "clamp(4.5rem, 18vmin, 20rem)"
    : "clamp(5rem, 26vmin, 32rem)";
  const labelSize = compact
    ? "clamp(0.75rem, 1.4vw, 1.5rem)"
    : "clamp(0.85rem, 2vw, 2rem)";

  return (
    <div className="flex flex-col items-center justify-center gap-[clamp(0.5rem,1.8vmin,1.75rem)] text-center">
      <div
        key={stage.label}
        className="sd-fade font-medium uppercase opacity-70"
        style={{ fontSize: labelSize, letterSpacing: "0.32em" }}
      >
        {stage.label}
      </div>

      <div
        className={`sd-fade font-mono font-bold leading-none tabular-nums ${stage.blink ? "sd-blink" : ""}`}
        style={{
          fontSize: timerSize,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatMMSS(stage.timerMs)}
      </div>

      {showStartsAt && (
        <div
          className="mt-[clamp(0.25rem,1vmin,1rem)] flex items-center gap-2 opacity-70"
          style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.4rem)" }}
        >
          <Clock className="h-[1em] w-[1em]" strokeWidth={1.5} />
          <span>Starts at {startsAtLabel}</span>
        </div>
      )}

      {hasNotes && (
        <>
          <div
            className={`${dividerTone} h-px w-[min(50vw,32rem)]`}
            style={{ marginTop: "clamp(0.5rem, 2vmin, 2rem)" }}
          />
          <div
            key={notes}
            className={`sd-fade whitespace-pre-wrap text-center font-medium leading-snug ${notesTone}`}
            style={{
              fontSize:
                notes.length > 200
                  ? "clamp(0.95rem, 1.4vw, 1.5rem)"
                  : "clamp(1.05rem, 1.8vw, 2rem)",
              maxWidth: "min(80ch, 90vw)",
              marginTop: "clamp(0.5rem, 2vmin, 2rem)",
            }}
          >
            {notes}
          </div>
        </>
      )}
    </div>
  );
}

const ICON_MAP: Record<IcebreakerItem["icon"], { Icon: typeof Globe; color: string }> = {
  globe:    { Icon: Globe,    color: "#60a5fa" }, // blue-400
  smile:    { Icon: Smile,    color: "#34d399" }, // emerald-400
  heart:    { Icon: Heart,    color: "#f87171" }, // red-400
  sparkles: { Icon: Sparkles, color: "#c084fc" }, // purple-400
  music:    { Icon: Music2,   color: "#f472b6" }, // pink-400
  sun:      { Icon: Sun,      color: "#fbbf24" }, // amber-400
};

function IcebreakerPanel({
  greeting,
  items,
  tip,
  onYellow,
}: {
  greeting: string;
  items: IcebreakerItem[];
  tip: string;
  onYellow: boolean;
}) {
  const textPrimary = onYellow ? "text-neutral-900" : "text-white";
  const textMuted = onYellow ? "text-neutral-900/75" : "text-white/80";
  const divider = onYellow ? "bg-neutral-900/15" : "bg-white/12";
  const chipColor = onYellow ? "text-indigo-700" : "text-indigo-300";
  const tipColor = onYellow ? "text-amber-700" : "text-amber-300";
  const tipMuted = onYellow ? "text-neutral-900/70" : "text-white/70";

  return (
    <div
      key={greeting}
      className="sd-fade flex h-full max-h-full flex-col justify-center gap-[clamp(0.75rem,1.8vmin,1.75rem)] pl-[clamp(0.5rem,2vw,2rem)]"
      style={{ borderLeft: onYellow ? "1px solid rgba(0,0,0,0.12)" : "1px solid rgba(255,255,255,0.12)" }}
    >
      <div>
        <div
          className={`font-semibold uppercase ${chipColor}`}
          style={{ fontSize: "clamp(0.7rem, 0.9vw, 1rem)", letterSpacing: "0.24em" }}
        >
          Icebreaker
        </div>
        <div
          className={`mt-[clamp(0.5rem,1vmin,1rem)] font-semibold leading-[1.1] ${textPrimary}`}
          style={{ fontSize: "clamp(1.75rem, 3.4vw, 3.5rem)", letterSpacing: "-0.02em" }}
        >
          {greeting}
        </div>
      </div>

      <ul className="flex flex-col">
        {items.map((it, i) => {
          const { Icon, color } = ICON_MAP[it.icon];
          return (
            <li key={i}>
              {i > 0 && <div className={`${divider} h-px w-full`} />}
              <div
                className={`flex items-center gap-[clamp(0.75rem,1.2vw,1.25rem)] py-[clamp(0.6rem,1.4vmin,1.15rem)] ${textPrimary}`}
                style={{ fontSize: "clamp(1rem, 1.55vw, 1.75rem)" }}
              >
                <Icon
                  className="shrink-0"
                  strokeWidth={1.8}
                  style={{
                    color,
                    width: "clamp(1.4rem, 2vw, 2.25rem)",
                    height: "clamp(1.4rem, 2vw, 2.25rem)",
                  }}
                />
                <span className="leading-snug">{it.text}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <div>
        <div
          className={`flex items-center gap-2 font-semibold uppercase ${tipColor}`}
          style={{ fontSize: "clamp(0.7rem, 0.9vw, 1rem)", letterSpacing: "0.22em" }}
        >
          <Lightbulb className="h-[1.1em] w-[1.1em]" strokeWidth={2} />
          Instructor Tip
        </div>
        <div
          className={`mt-[clamp(0.35rem,0.8vmin,0.8rem)] leading-snug ${tipMuted}`}
          style={{ fontSize: "clamp(0.9rem, 1.25vw, 1.4rem)", maxWidth: "56ch" }}
        >
          {tip}
        </div>
      </div>
    </div>
  );
}
