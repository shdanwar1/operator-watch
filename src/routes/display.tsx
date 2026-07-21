import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStudioDisplay } from "@/hooks/useStudioDisplay";
import { computeStage, formatMMSS } from "@/lib/studio-display";

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

function DisplayScreen() {
  const { state, ready } = useStudioDisplay("display");
  const [, force] = useState(0);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!ready) return null;

  const stage = computeStage(state);
  const hasNotes = !!state.notes.trim();
  const notesTone = stage.phase === "warn5" ? "text-neutral-900/85" : "text-white/85";
  const dividerTone = stage.phase === "warn5" ? "bg-neutral-900/20" : "bg-white/20";

  return (
    <div
      className={`fixed inset-0 flex flex-col items-center justify-center overflow-hidden ${stage.bg} ${stage.fg} transition-colors duration-700 ease-out ${stage.pulse ? "sd-pulse-bg" : ""}`}
      style={{ padding: "clamp(1rem, 4vmin, 4rem)" }}
    >
      <div className="flex w-full max-w-[92vw] flex-col items-center justify-center gap-[clamp(0.75rem,2vmin,2rem)] text-center">
        <div
          key={stage.label}
          className="sd-fade font-medium uppercase opacity-70"
          style={{
            fontSize: "clamp(0.85rem, 2vw, 2rem)",
            letterSpacing: "0.32em",
          }}
        >
          {stage.label}
        </div>

        <div
          className={`sd-fade font-mono font-bold leading-none tabular-nums ${stage.blink ? "sd-blink" : ""}`}
          style={{
            fontSize: "clamp(5rem, 26vmin, 32rem)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatMMSS(stage.timerMs)}
        </div>

        {hasNotes && (
          <>
            <div
              className={`${dividerTone} h-px w-[min(50vw,32rem)]`}
              style={{ marginTop: "clamp(0.5rem, 2vmin, 2rem)" }}
            />
            <div
              key={state.notes}
              className={`sd-fade whitespace-pre-wrap text-center font-medium leading-snug ${notesTone}`}
              style={{
                fontSize:
                  state.notes.length > 200
                    ? "clamp(1rem, 1.6vw, 1.75rem)"
                    : "clamp(1.15rem, 2.1vw, 2.25rem)",
                maxWidth: "min(80ch, 90vw)",
                marginTop: "clamp(0.5rem, 2vmin, 2rem)",
              }}
            >
              {state.notes}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
