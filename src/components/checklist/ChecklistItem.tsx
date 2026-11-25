import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { tapHaptic } from "@/lib/haptics";
import type { ChecklistSnapshotItem } from "@/domain/checklists";

/** One checkable line of a checklist. Presentation only — state lives above. */
export function ChecklistItem({
  item,
  index,
  total,
  readOnly,
  isNext,
  onToggle,
}: {
  item: ChecklistSnapshotItem;
  index: number;
  total: number;
  readOnly?: boolean;
  /** First unticked item: gets a calm accent so the next step is obvious at a glance. */
  isNext?: boolean;
  onToggle: (completed: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "relative flex min-h-[44px] touch-manipulation select-none items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors sm:px-2.5 sm:py-2 max-lg:rounded-none max-lg:after:absolute max-lg:after:bottom-0 max-lg:after:left-11 max-lg:after:right-0 max-lg:after:h-[0.5px] max-lg:after:bg-border max-lg:last:after:hidden",
        readOnly
          ? "cursor-default opacity-70"
          : "cursor-pointer hover:bg-muted/40 active:bg-muted/60",
        isNext && "bg-primary/10 shadow-[inset_3px_0_0_0_var(--primary)] font-medium",
      )}
      aria-current={isNext ? "step" : undefined}
    >
      <Checkbox
        checked={item.completed}
        disabled={readOnly}
        onCheckedChange={(v) => {
          if (v === true) tapHaptic();
          onToggle(v === true);
        }}
        className="mt-px h-5 w-5 shrink-0"
        aria-label={item.text}
      />
      <span
        className={cn(
          "min-w-0 flex-1 break-words leading-snug",
          item.completed && "text-muted-foreground line-through",
        )}
      >
        {item.text}
      </span>
      <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground max-sm:hidden">
        {index + 1} / {total}
      </span>
    </label>
  );
}
