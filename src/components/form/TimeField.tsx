import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nudgeTime } from "@/domain/time-entry";

const STEPS = [-15, -5, 5, 15];

/** Native time picker plus large ±5/±15 minute buttons for one-thumb correction. */
export function TimeField({ id, label, value, onChange, disabled }: {
  id: string; label: string; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="time" className="h-11" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="grid grid-cols-4 gap-1">
        {STEPS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled || !value}
            onClick={() => { const n = nudgeTime(value, d); if (n) onChange(n); }}
            aria-label={`${label} ${d > 0 ? "plus" : "minus"} ${Math.abs(d)} minutes`}
            className="h-11 rounded-md border border-input text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent active:bg-accent disabled:opacity-40"
          >
            {d > 0 ? `+${d}` : `−${-d}`}
          </button>
        ))}
      </div>
    </div>
  );
}
