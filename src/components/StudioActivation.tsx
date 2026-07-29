import { useEffect, useState } from "react";
import { Camera, Check, Mic, Radio } from "lucide-react";

const ITEMS = [
  { icon: Camera, label: "Camera" },
  { icon: Mic, label: "Audio" },
  { icon: Radio, label: "Streaming" },
];

/** Short (<1s) "studio systems coming online" transition shown after check in. */
export function StudioActivation({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 160),
      setTimeout(() => setStep(2), 340),
      setTimeout(() => setStep(3), 520),
      setTimeout(() => setStep(4), 720),
      setTimeout(() => onDone(), 1400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-xl"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm px-8 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Studio Online</h2>
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
              <Check className="ml-auto h-4 w-4 text-emerald-500" />
            </li>
          ))}
        </ul>
        <div className="mt-8 border-t border-border/60 pt-6">
          <div
            className="flex items-center justify-center gap-2 transition-opacity duration-500"
            style={{ opacity: step > 3 ? 1 : 0 }}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-lg font-semibold tracking-tight text-emerald-500">ON AIR</span>
          </div>
        </div>
        <p className="mt-8 text-xs text-muted-foreground">Redirecting to dashboard…</p>
      </div>
    </div>
  );
}
