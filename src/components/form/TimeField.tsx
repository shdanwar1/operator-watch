import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nudgeTime } from "@/domain/time-entry";
import { cn } from "@/lib/utils";

const STEPS = [-15, -5, 5, 15];

/** Native time picker plus large ±5/±15 minute buttons for one-thumb correction. */
export function TimeField({
  id,
  label,
  value,
  onChange,
  disabled,
  dateValue,
  onDateChange,
  onNudge,
  onNow,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  dateValue?: string;
  onDateChange?: (v: string) => void;
  onNudge?: (delta: number) => void;
  onNow?: () => void;
}) {
  const hasDate = dateValue !== undefined;
  const canNudge = !disabled && !!value && (!hasDate || !!dateValue);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className={cn(hasDate && "grid grid-cols-2 gap-2")}>
        {hasDate && (
          <Input
            id={`${id}-date`}
            aria-label={`${label} date`}
            type="date"
            className="h-11 min-w-0"
            disabled={disabled}
            value={dateValue}
            onChange={(e) => onDateChange?.(e.target.value)}
          />
        )}
        <Input
          id={id}
          aria-label={hasDate ? `${label} time` : undefined}
          type="time"
          className="h-11 min-w-0"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <div className={cn("grid gap-1", onNow ? "grid-cols-5" : "grid-cols-4")}>
        {STEPS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={!canNudge}
            onClick={() => {
              if (onNudge) {
                onNudge(d);
                return;
              }
              const n = nudgeTime(value, d);
              if (n) onChange(n);
            }}
            aria-label={`${label} ${d > 0 ? "plus" : "minus"} ${Math.abs(d)} minutes`}
            className="h-11 rounded-md border border-input text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent active:bg-accent disabled:opacity-40"
          >
            {d > 0 ? `+${d}` : `−${-d}`}
          </button>
        ))}
        {onNow && (
          <button
            type="button"
            disabled={disabled}
            onClick={onNow}
            aria-label={`Set ${label.toLowerCase()} to now`}
            className="h-11 rounded-md border border-input text-xs font-medium text-muted-foreground transition-colors hover:bg-accent active:bg-accent disabled:opacity-40"
          >
            Now
          </button>
        )}
      </div>
    </div>
  );
}
