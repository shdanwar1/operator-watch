import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Fingerprint } from "lucide-react";

const HOLD_MS = 3000;

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

/**
 * Calm, Touch-ID style hold-to-confirm control.
 * The icon and closing ring carry the whole message — no labels, no counters.
 * `label` is used for accessibility only. `hint` renders only when explicitly passed.
 */
export function HoldButton({
  label,
  successLabel,
  tone = "primary",
  disabled,
  busy,
  onComplete,
  size = 100,
  hint,
}: {
  label: string;
  /** Kept for API compatibility; no success text is rendered anymore. */
  successLabel?: string;
  tone?: HoldButtonTone;
  disabled?: boolean;
  busy?: boolean;
  onComplete: () => void;
  size?: number;
  /** Optional helper text. Omit unless it changes the user's decision. */
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
                navigator.vibrate?.(14);
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

  const stroke = 3;
  const r = size / 2 - stroke * 2;
  const c = 2 * Math.PI * r;

  const ringColor = tone === "danger" ? "oklch(0.64 0.20 25)" : "oklch(0.62 0.16 255)";
  const successRing = "oklch(0.72 0.17 155)";

  const scale = done ? 1.08 : holding ? (reduced ? 1 : 1.06) : 1;

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabled || busy}
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
        className="relative select-none rounded-full outline-none transition-transform duration-300 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45"
        style={{
          width: size,
          height: size,
          transform: `scale(${scale})`,
          touchAction: "none",
        }}
      >
        {/* face */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-border/70 bg-gradient-to-b from-background to-muted/60 shadow-[0_6px_18px_-8px_rgba(0,0,0,0.45)]"
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
            strokeWidth={stroke}
            className="text-border/60"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={done ? successRing : ringColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - (done ? 1 : progress))}
            style={{ transition: "stroke 300ms ease" }}
          />
        </svg>

        <span className="absolute inset-0 flex items-center justify-center">
          {done ? (
            <Check
              className="h-7 w-7 text-done"
              style={{ animation: reduced ? undefined : "hold-pop 420ms ease-out" }}
            />
          ) : (
            <Fingerprint
              className={`h-7 w-7 transition-colors duration-300 ${
                holding ? "text-foreground" : "text-muted-foreground"
              }`}
            />
          )}
        </span>
      </button>
      {!done && (busy || hint) ? (
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {busy ? "Working…" : hint}
        </p>
      ) : null}

    </div>
  );
}
