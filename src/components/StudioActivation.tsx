import { useEffect, useRef, useState } from "react";
import { Camera, Check, Mic, Radio } from "lucide-react";

const ITEMS = [
  { icon: Radio, label: "Going on air" },
  { icon: Camera, label: "Camera ready" },
  { icon: Mic, label: "Loading studio" },
];

/** Hard cap: the overlay can never block the operator for longer than this. */
const MAX_MS = 3000;

/** "Going on air" transition shown after check in. Always exits within 3s. */
export function StudioActivation({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const firedRef = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      try {
        onDone();
      } catch (err) {
        console.error(err);
      }
    };
    const timers = [
      setTimeout(() => setStep(1), 300),
      setTimeout(() => setStep(2), 900),
      setTimeout(() => setStep(3), 1500),
      setTimeout(() => setStep(4), 2100),
      // Hard timeout — fires regardless of animation state.
      setTimeout(finish, MAX_MS),
    ];
    return () => {
      timers.forEach(clearTimeout);
      // If the overlay unmounts early, make sure the flow still completes.
      finish();
    };
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-xl"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm px-8 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Going On Air</h2>
        <ul className="mt-8 space-y-4">
          {ITEMS.map(({ icon: Icon, label }, i) => (
            <li
              key={label}
              className="flex items-center gap-3 transition-all duration-500 ease-out"
              style={{
                opacity: step > i ? 1 : 0,
                transform: step > i ? "translateY(0)" : "translateY(6px)",
              }}
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{label}</span>
              <Check className="ml-auto h-4 w-4 text-done" />
            </li>
          ))}
        </ul>
        <div className="mt-8 border-t border-border/60 pt-6">
          <div
            className="flex items-center justify-center gap-2 transition-opacity duration-500"
            style={{ opacity: step > 3 ? 1 : 0 }}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-live" />
            <span className="text-lg font-semibold tracking-tight text-live">Connected</span>
          </div>
        </div>
      </div>
    </div>
  );
}
