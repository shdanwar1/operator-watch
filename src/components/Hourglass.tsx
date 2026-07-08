import { useEffect, useState } from "react";

export type HourglassState = "calm" | "warm" | "fast" | "urgent" | "ready";

export function Hourglass({
  percent,
  state,
  size = 180,
}: {
  /** 0..1 — fraction of sand still in the top chamber (time remaining). */
  percent: number;
  state: HourglassState;
  size?: number;
}) {
  const fill = Math.max(0, Math.min(1, percent));
  const drained = 1 - fill;

  // Geometry (viewBox 100x160).
  const TOP_Y = 12;
  const NECK_Y = 80;
  const BOTTOM_Y = 148;
  const HALF_W_TOP = 38;

  // Upper sand: surface descends toward the neck as time passes.
  const surfaceY = TOP_Y + (1 - fill) * (NECK_Y - TOP_Y);
  const surfaceHalfW = HALF_W_TOP * (NECK_Y - surfaceY) / (NECK_Y - TOP_Y);

  // Lower sand: mound rises from the base toward the neck.
  const moundY = BOTTOM_Y - drained * (BOTTOM_Y - NECK_Y);
  const moundHalfW = HALF_W_TOP * (BOTTOM_Y - moundY) / (BOTTOM_Y - NECK_Y);

  const showStream = fill > 0.001 && fill < 0.999 && state !== "ready";

  // Palette per state.
  const palette = {
    calm:   { sand: "#60a5fa", glow: "rgba(96,165,250,0.35)", stream: "1.6s" },
    warm:   { sand: "#f5b942", glow: "rgba(245,185,66,0.45)",  stream: "0.9s" },
    fast:   { sand: "#f59e0b", glow: "rgba(245,158,11,0.55)",  stream: "0.45s" },
    urgent: { sand: "#ef4444", glow: "rgba(239,68,68,0.65)",   stream: "0.3s" },
    ready:  { sand: "#22c55e", glow: "rgba(34,197,94,0.55)",   stream: "0s" },
  }[state];

  return (
    <div
      className={state === "urgent" || state === "ready" ? "hg-pulse" : ""}
      style={{
        width: size,
        height: size * (160 / 100),
        filter: `drop-shadow(0 0 22px ${palette.glow})`,
        transition: "filter 600ms ease",
      }}
    >
      <svg viewBox="0 0 100 160" width="100%" height="100%" aria-hidden>
        <defs>
          {/* subtle vertical shading on the sand */}
          <linearGradient id="hg-sand-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={palette.sand} stopOpacity="0.95" />
            <stop offset="100%" stopColor={palette.sand} stopOpacity="0.75" />
          </linearGradient>
          {/* clip to the top chamber shape */}
          <clipPath id="hg-top-clip">
            <polygon points={`${50 - HALF_W_TOP},${TOP_Y} ${50 + HALF_W_TOP},${TOP_Y} 50,${NECK_Y}`} />
          </clipPath>
          {/* clip to the bottom chamber shape */}
          <clipPath id="hg-bot-clip">
            <polygon points={`50,${NECK_Y} ${50 + HALF_W_TOP},${BOTTOM_Y} ${50 - HALF_W_TOP},${BOTTOM_Y}`} />
          </clipPath>
        </defs>

        {/* Wooden caps */}
        <rect x="6" y="4" width="88" height="8" rx="2" fill="currentColor" opacity="0.85" />
        <rect x="6" y="148" width="88" height="8" rx="2" fill="currentColor" opacity="0.85" />

        {/* Glass frame */}
        <polygon
          points={`${50 - HALF_W_TOP},${TOP_Y} ${50 + HALF_W_TOP},${TOP_Y} 50,${NECK_Y}`}
          fill="currentColor"
          fillOpacity="0.06"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <polygon
          points={`50,${NECK_Y} ${50 + HALF_W_TOP},${BOTTOM_Y} ${50 - HALF_W_TOP},${BOTTOM_Y}`}
          fill="currentColor"
          fillOpacity="0.06"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />

        {/* Upper sand — surface drops with time */}
        <g clipPath="url(#hg-top-clip)">
          {fill > 0.001 && (
            <polygon
              points={`
                ${50 - surfaceHalfW},${surfaceY}
                ${50 + surfaceHalfW},${surfaceY}
                50,${NECK_Y}
              `}
              fill="url(#hg-sand-grad)"
              style={{ transition: "all 900ms linear" }}
            />
          )}
        </g>

        {/* Falling sand stream */}
        {showStream && (
          <rect
            x="49.4"
            y={NECK_Y - 1}
            width="1.2"
            height={moundY - NECK_Y + 2}
            fill={palette.sand}
            className="hg-stream"
            style={{ animationDuration: palette.stream }}
          />
        )}

        {/* Lower sand — mound grows from the base */}
        <g clipPath="url(#hg-bot-clip)">
          {drained > 0.001 && (
            <polygon
              points={`
                ${50 - moundHalfW},${moundY}
                ${50 + moundHalfW},${moundY}
                ${50 + HALF_W_TOP},${BOTTOM_Y}
                ${50 - HALF_W_TOP},${BOTTOM_Y}
              `}
              fill="url(#hg-sand-grad)"
              style={{ transition: "all 900ms linear" }}
            />
          )}
        </g>
      </svg>
    </div>
  );
}

/** Derive live UI state from the millisecond remaining to check-in. */
export function hourglassStateFor(remainingMs: number): HourglassState {
  if (remainingMs <= 0) return "ready";
  const mins = remainingMs / 60000;
  if (mins < 10) return "urgent";
  if (mins < 30) return "fast";
  if (mins < 180) return "warm";
  return "calm";
}

/** 1s ticker for live countdowns. */
export function useSecondTicker() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(t);
  }, []);
}
