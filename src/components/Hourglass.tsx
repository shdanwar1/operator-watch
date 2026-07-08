import { useEffect, useState } from "react";

export type HourglassState = "calm" | "warm" | "fast" | "urgent" | "ready";

// Geometry (viewBox 100 x 180) — curved bulbs with a soft neck.
const TOP_CAP_Y = 4;
const BULB_TOP_Y = 14;
const NECK_Y = 90;
const BULB_BOT_Y = 166;
const BOT_CAP_Y = 166;

const TOP_BULB_D =
  `M 18 ${BULB_TOP_Y}
   C 18 48 42 66 50 ${NECK_Y}
   C 58 66 82 48 82 ${BULB_TOP_Y} Z`;

const BOT_BULB_D =
  `M 18 ${BULB_BOT_Y}
   C 18 132 42 114 50 ${NECK_Y}
   C 58 114 82 132 82 ${BULB_BOT_Y} Z`;

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

  // Surface of the upper sand descends toward the neck.
  const surfaceY = BULB_TOP_Y + (1 - fill) * (NECK_Y - BULB_TOP_Y);
  // Mound top rises from the base toward the neck.
  const moundY = BULB_BOT_Y - drained * (BULB_BOT_Y - NECK_Y);

  const showStream = fill > 0.001 && fill < 0.999 && state !== "ready";

  const palette = {
    calm:   { sand: "#7aa7f0", glow: "rgba(122,167,240,0.28)", stream: "1.5s" },
    warm:   { sand: "#e8b768", glow: "rgba(232,183,104,0.38)", stream: "0.9s" },
    fast:   { sand: "#eb9a3c", glow: "rgba(235,154,60,0.5)",   stream: "0.5s" },
    urgent: { sand: "#e26363", glow: "rgba(226,99,99,0.6)",    stream: "0.3s" },
    ready:  { sand: "#5ec38a", glow: "rgba(94,195,138,0.5)",   stream: "0s" },
  }[state];

  return (
    <div
      className={state === "urgent" || state === "ready" ? "hg-pulse" : ""}
      style={{
        width: size,
        height: size * (180 / 100),
        filter: `drop-shadow(0 6px 14px ${palette.glow})`,
        transition: "filter 700ms ease",
      }}
    >
      <svg viewBox="0 0 100 180" width="100%" height="100%" aria-hidden>
        <defs>
          {/* Soft vertical shading for sand */}
          <linearGradient id="hg-sand" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={palette.sand} stopOpacity="0.95" />
            <stop offset="100%" stopColor={palette.sand} stopOpacity="0.7" />
          </linearGradient>
          {/* Glass sheen */}
          <linearGradient id="hg-glass" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="40%" stopColor="currentColor" stopOpacity="0.02" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
          </linearGradient>
          <clipPath id="hg-top-clip"><path d={TOP_BULB_D} /></clipPath>
          <clipPath id="hg-bot-clip"><path d={BOT_BULB_D} /></clipPath>
        </defs>

        {/* Wooden caps — soft rounded pills */}
        <rect
          x="10" y={TOP_CAP_Y} width="80" height="10" rx="5"
          fill="currentColor" opacity="0.75"
        />
        <rect
          x="10" y={BOT_CAP_Y + 4} width="80" height="10" rx="5"
          fill="currentColor" opacity="0.75"
        />

        {/* Glass bulbs — filled with subtle sheen, outlined with soft stroke */}
        <path d={TOP_BULB_D} fill="url(#hg-glass)" />
        <path d={BOT_BULB_D} fill="url(#hg-glass)" />

        {/* Upper sand — a rect clipped to the bulb so the surface follows the curve */}
        <g clipPath="url(#hg-top-clip)">
          {fill > 0.001 && (
            <rect
              x="0"
              y={surfaceY}
              width="100"
              height={NECK_Y - surfaceY + 0.5}
              fill="url(#hg-sand)"
              style={{ transition: "y 900ms linear, height 900ms linear" }}
            />
          )}
          {/* Surface highlight */}
          {fill > 0.02 && (
            <line
              x1="0" x2="100" y1={surfaceY} y2={surfaceY}
              stroke="#ffffff" strokeOpacity="0.35" strokeWidth="0.6"
              style={{ transition: "all 900ms linear" }}
            />
          )}
        </g>

        {/* Falling stream */}
        {showStream && (
          <rect
            x="49.4"
            y={NECK_Y - 0.5}
            width="1.2"
            height={Math.max(2, moundY - NECK_Y + 1)}
            rx="0.6"
            fill={palette.sand}
            className="hg-stream"
            style={{ animationDuration: palette.stream }}
          />
        )}

        {/* Lower sand — mound rises from the base */}
        <g clipPath="url(#hg-bot-clip)">
          {drained > 0.001 && (
            <rect
              x="0"
              y={moundY}
              width="100"
              height={BULB_BOT_Y - moundY + 0.5}
              fill="url(#hg-sand)"
              style={{ transition: "y 900ms linear, height 900ms linear" }}
            />
          )}
          {/* Rounded mound top: soft ellipse cap on the pile */}
          {drained > 0.02 && (
            <ellipse
              cx="50"
              cy={moundY}
              rx={18 + drained * 14}
              ry="2"
              fill="url(#hg-sand)"
              style={{ transition: "all 900ms linear" }}
            />
          )}
        </g>

        {/* Glass outline — soft, rounded */}
        <path
          d={TOP_BULB_D}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d={BOT_BULB_D}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />

        {/* Left-side glass sheen highlight */}
        <path
          d="M 24 22 C 22 44 34 62 46 84"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.18"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M 46 96 C 34 118 22 136 24 158"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.12"
          strokeWidth="1"
          strokeLinecap="round"
        />

        {/* Neck highlight */}
        <ellipse cx="50" cy={NECK_Y} rx="3.2" ry="0.9" fill="currentColor" opacity="0.35" />
      </svg>
    </div>
  );
}

/** Derive live UI state from the milliseconds remaining to check-in. */
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
