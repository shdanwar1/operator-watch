import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ChecklistSnapshotItem } from "@/domain/checklists";

/** One checkable line of a checklist. Presentation only — state lives above. */
export function ChecklistItem({
  item,
  index,
  total,
  readOnly,
  onToggle,
}: {
  item: ChecklistSnapshotItem;
  index: number;
  total: number;
  readOnly?: boolean;
  onToggle: (completed: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors",
        readOnly ? "cursor-default opacity-70" : "cursor-pointer hover:bg-muted/40",
      )}
    >
      <Checkbox
        checked={item.completed}
        disabled={readOnly}
        onCheckedChange={(v) => onToggle(v === true)}
        className="mt-0.5 h-[18px] w-[18px] shrink-0"
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
