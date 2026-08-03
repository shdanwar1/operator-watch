import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Radio } from "lucide-react";

const HOLD_MS = 2000;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

export type HoldButtonTone = "primary" | "danger";

export function HoldButton({
  label,
  successLabel,
  tone = "primary",
  disabled,
  busy,
  onComplete,
  size = 240,
  hint = "Hold for 3 seconds",
}: {
  label: string;
  successLabel?: string;
  tone?: HoldButtonTone;
  disabled?: boolean;
  busy?: boolean;
  onComplete: () => void;
  size?: number;
  hint?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [progress, setProgress] = useState(0); // 0..1
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);
  const rafRef = useRef<number | null>(null);
  const holdingRef = useRef(false);
  const progressRef = useRef(0);
  const lastRef = useRef(0);
  const doneRef = useRef(false);

  const stopLoop = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  useEffect(() => () => stopLoop(), []);

  const tick = useCallback(
    (t: number) => {
      const dt = lastRef.current ? t - lastRef.current : 16;
      lastRef.current = t;
      let p = progressRef.current;
      if (holdingRef.current) {
        p += dt / HOLD_MS;
        if (p >= 1) {
          p = 1;
          progressRef.current = 1;
          setProgress(1);
          holdingRef.current = false;
          setHolding(false);
          if (!doneRef.current) {
            doneRef.current = true;
            setDone(true);
            if (typeof navigator !== "undefined" && "vibrate" in navigator) {
              try {
                navigator.vibrate?.(18);
              } catch {
                /* ignore */
              }
            }
            onComplete();
          }
          stopLoop();
          return;
        }
      } else {
        // graceful reverse, ~2x speed
        p -= (dt / HOLD_MS) * 2;
        if (p <= 0) {
          progressRef.current = 0;
          setProgress(0);
          stopLoop();
          return;
        }
      }
      progressRef.current = p;
      setProgress(p);
      rafRef.current = requestAnimationFrame(tick);
    },
    [onComplete],
  );

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;
    lastRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const start = useCallback(() => {
    if (disabled || busy || doneRef.current) return;
    holdingRef.current = true;
    setHolding(true);
    startLoop();
  }, [disabled, busy, startLoop]);

  const end = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    startLoop();
  }, [startLoop]);

  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const pct = Math.round(progress * 100);

  const ringColor = tone === "danger" ? "oklch(0.64 0.20 25)" : "oklch(0.62 0.16 255)";
  const successRing = "oklch(0.72 0.17 155)";

  const scale = done ? 1.015 : holding ? (reduced ? 1 : 1.03) : 1;

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabled || busy}
        role="button"
        disabled={disabled || busy}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          start();
        }}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (!e.repeat) start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") end();
        }}
        onBlur={end}
        className="relative select-none rounded-full outline-none transition-[transform,box-shadow] duration-500 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          width: size,
          height: size,
          transform: `scale(${scale})`,
          touchAction: "none",
        }}
      >
        {/* ambient glow */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full transition-opacity duration-700"
          style={{
            boxShadow: done
              ? `0 0 60px 6px ${successRing.replace(")", " / 0.35)")}`
              : `0 0 44px 2px ${ringColor.replace(")", " / 0.22)")}`,
            opacity: holding && !reduced ? 1 : 0.75,
            animation:
              holding && !reduced ? "hold-breathe 2.4s ease-in-out infinite" : undefined,
          }}
        />
        {/* face */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-border/70 bg-gradient-to-b from-background/90 to-muted/70 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur-sm"
        />
        <svg
          className="absolute inset-0 -rotate-90"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={4}
            className="text-border/60"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={done ? successRing : ringColor}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - (done ? 1 : progress))}
            style={{ transition: "stroke 400ms ease" }}
          />
        </svg>

        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
          {done ? (
            <>
              <Check
                className="h-9 w-9 text-emerald-500"
                style={{ animation: reduced ? undefined : "hold-pop 420ms ease-out" }}
              />
              <span className="text-base font-medium tracking-tight">
                {successLabel ?? "Done"}
              </span>
            </>
          ) : holding || progress > 0 ? (
            <>
              <span className="text-xs text-muted-foreground">Keep holding…</span>
              <span className="font-mono text-4xl font-semibold tabular-nums tracking-tight">
                {pct}
                <span className="ml-0.5 text-lg font-normal text-muted-foreground">%</span>
              </span>
            </>
          ) : (
            <>
              <Radio className="mb-1 h-5 w-5 text-muted-foreground" />
              <span className="text-lg font-medium leading-tight tracking-tight">{label}</span>
            </>
          )}
        </span>
      </button>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {busy ? "Working…" : done ? "" : hint}
      </p>
    </div>
  );
}
