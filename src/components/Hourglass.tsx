import { useEffect, useState } from "react";

export type HourglassState = "calm" | "warm" | "fast" | "urgent" | "ready";

// Geometry (viewBox 100 x 180) — slender, elegant silhouette.
const TOP_CAP_Y = 2;
const CAP_H = 8;
const BULB_TOP_Y = 12;
const NECK_Y = 90;
const BULB_BOT_Y = 168;

// Slim, apothecary-style bulbs: wider shoulders, gentler taper into the neck.
const TOP_BULB_D =
  `M 16 ${BULB_TOP_Y}
   C 16 40 30 60 48 ${NECK_Y - 2}
   Q 50 ${NECK_Y} 52 ${NECK_Y - 2}
   C 70 60 84 40 84 ${BULB_TOP_Y} Z`;

const BOT_BULB_D =
  `M 16 ${BULB_BOT_Y}
   C 16 140 30 120 48 ${NECK_Y + 2}
   Q 50 ${NECK_Y} 52 ${NECK_Y + 2}
   C 70 120 84 140 84 ${BULB_BOT_Y} Z`;

export function Hourglass({
  percent,
  state,
  size,
  className,
}: {
  /** 0..1 — fraction of sand still in the top chamber (time remaining). */
  percent: number;
  state: HourglassState;
  /** Fixed pixel width. Omit and pass `className` for responsive sizing. */
  size?: number;
  className?: string;
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

  const dimStyle =
    size != null
      ? { width: size, height: size * (180 / 100) }
      : undefined;

  return (
    <div
      className={`${state === "urgent" || state === "ready" ? "hg-pulse " : ""}${className ?? ""}`}
      style={{
        ...dimStyle,
        aspectRatio: "100 / 180",
        filter: `drop-shadow(0 8px 18px ${palette.glow})`,
        transition: "filter 700ms ease",
      }}
    >
      <svg viewBox="0 0 100 180" width="100%" height="100%" aria-hidden>
        <defs>
          {/* Vertical sand shading */}
          <linearGradient id="hg-sand" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={palette.sand} stopOpacity="1" />
            <stop offset="100%" stopColor={palette.sand} stopOpacity="0.72" />
          </linearGradient>
          {/* Glass sheen */}
          <linearGradient id="hg-glass" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="45%" stopColor="currentColor" stopOpacity="0.02" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.10" />
          </linearGradient>
          {/* Wooden cap — subtle bevel */}
          <linearGradient id="hg-cap" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="50%" stopColor="currentColor" stopOpacity="0.7" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.85" />
          </linearGradient>
          <clipPath id="hg-top-clip"><path d={TOP_BULB_D} /></clipPath>
          <clipPath id="hg-bot-clip"><path d={BOT_BULB_D} /></clipPath>
        </defs>

        {/* Caps — with slender inner plate for a wood/brass look */}
        <rect x="6" y={TOP_CAP_Y} width="88" height={CAP_H} rx="3" fill="url(#hg-cap)" />
        <rect x="10" y={TOP_CAP_Y + CAP_H - 1.5} width="80" height="1.5" fill="currentColor" opacity="0.35" />
        <rect x="6" y={BULB_BOT_Y + 2} width="88" height={CAP_H} rx="3" fill="url(#hg-cap)" />
        <rect x="10" y={BULB_BOT_Y + 2} width="80" height="1.5" fill="currentColor" opacity="0.35" />

        {/* Glass fills */}
        <path d={TOP_BULB_D} fill="url(#hg-glass)" />
        <path d={BOT_BULB_D} fill="url(#hg-glass)" />

        {/* Upper sand — curved surface follows a shallow meniscus */}
        <g clipPath="url(#hg-top-clip)">
          {fill > 0.001 && (
            <path
              d={`M -5 ${surfaceY}
                  Q 50 ${surfaceY + 2.6} 105 ${surfaceY}
                  L 105 ${NECK_Y + 2}
                  L -5 ${NECK_Y + 2} Z`}
              fill="url(#hg-sand)"
              style={{ transition: "d 900ms linear" }}
            />
          )}
          {fill > 0.02 && (
            <path
              d={`M -5 ${surfaceY} Q 50 ${surfaceY + 2.6} 105 ${surfaceY}`}
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.4"
              strokeWidth="0.6"
              style={{ transition: "d 900ms linear" }}
            />
          )}
        </g>

        {/* Falling stream */}
        {showStream && (
          <rect
            x="49.3"
            y={NECK_Y - 0.5}
            width="1.4"
            height={Math.max(2, moundY - NECK_Y + 1)}
            rx="0.7"
            fill={palette.sand}
            className="hg-stream"
            style={{ animationDuration: palette.stream }}
          />
        )}

        {/* Lower sand — mound with rounded cap */}
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
          {drained > 0.02 && (
            <ellipse
              cx="50"
              cy={moundY}
              rx={12 + drained * 20}
              ry={2 + drained * 1.2}
              fill="url(#hg-sand)"
              style={{ transition: "all 900ms linear" }}
            />
          )}
        </g>

        {/* Glass outline */}
        <path
          d={TOP_BULB_D}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <path
          d={BOT_BULB_D}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />

        {/* Left-side sheen highlights */}
        <path
          d="M 22 20 C 20 42 32 60 44 82"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.2"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M 44 98 C 32 120 20 138 22 160"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.14"
          strokeWidth="1"
          strokeLinecap="round"
        />

        {/* Neck collar — subtle brass ring */}
        <ellipse cx="50" cy={NECK_Y} rx="3.6" ry="1.1" fill="currentColor" opacity="0.4" />
        <ellipse cx="50" cy={NECK_Y - 0.4} rx="3.6" ry="0.5" fill="#ffffff" opacity="0.18" />
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
