import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStudioDisplay } from "@/hooks/useStudioDisplay";
import { computeTimer, formatMMSS } from "@/lib/studio-display";

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

  const { phase, remainingMs } = computeTimer(state);
  const label =
    phase === "before"
      ? "Class starts in"
      : phase === "running"
        ? "Time remaining"
        : "Class complete";

  const timeColor =
    phase === "running" && remainingMs < 60_000
      ? "text-red-400"
      : phase === "complete"
        ? "text-emerald-400"
        : "text-white";

  const closingNote =
    phase === "complete" && !state.notes.trim() ? "Thank you! See you next class." : state.notes;

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-black px-8 text-white">
      <div className="mb-8 text-lg font-medium uppercase tracking-[0.35em] text-white/60 sm:text-2xl">
        {label}
      </div>
      <div
        className={`font-mono text-[22vw] font-bold leading-none tabular-nums sm:text-[18vw] ${timeColor}`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {formatMMSS(remainingMs)}
      </div>
      {closingNote?.trim() && (
        <>
          <div className="my-10 h-px w-1/2 bg-white/15" />
          <div className="max-w-4xl whitespace-pre-wrap text-center text-2xl leading-relaxed text-white/90 sm:text-3xl">
            {closingNote}
          </div>
        </>
      )}
    </div>
  );
}
