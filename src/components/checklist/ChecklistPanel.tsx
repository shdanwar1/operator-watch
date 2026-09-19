import { useState } from "react";
import { Check, ChevronDown, ListChecks } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { checklistProgress, type ChecklistSnapshotItem } from "@/domain/checklists";
import { ChecklistItem } from "./ChecklistItem";

/**
 * Collapsible checklist. Headings (Ballet / Workout) are display-only labels
 * printed above the first item that carries them — never a nested structure.
 */
export function ChecklistPanel({
  title,
  items,
  readOnly,
  loading,
  variant = "card",
  onToggleItem,
}: {
  title: string;
  items: ChecklistSnapshotItem[];
  readOnly?: boolean;
  loading?: boolean;
  /** "card" = standalone (Start / End), "inline" = inside a class row. */
  variant?: "card" | "inline";
  onToggleItem: (itemId: string, completed: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const { completed, total, complete } = checklistProgress(items);

  const header = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
      aria-expanded={open}
      className={cn("flex w-full items-center gap-2 text-left", variant === "inline" && "text-xs")}
    >
      {variant === "card" ? (
        <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : null}
      <span className={cn("min-w-0 flex-1 truncate font-medium", variant === "card" && "text-sm")}>
        {title}
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 text-xs tabular-nums",
          complete ? "text-done" : "text-muted-foreground",
        )}
      >
        {complete && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        {loading ? "…" : `${completed} / ${total}`}
      </span>
      <ChevronDown
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-180",
        )}
      />
    </button>
  );

  const body = !open ? null : loading ? (
    <p className="px-2 py-3 text-xs text-muted-foreground">Loading checklist…</p>
  ) : total === 0 ? (
    <p className="px-2 py-3 text-xs text-muted-foreground">No checklist items.</p>
  ) : (
    <div className="max-h-[420px] overflow-y-auto overscroll-contain">
      {items.map((item, i) => {
        const heading = item.heading;
        const showHeading = !!heading && heading !== items[i - 1]?.heading;
        return (
          <div key={item.id}>
            {showHeading && (
              <div className="mt-3 px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground first:mt-0">
                {heading}
              </div>
            )}
            <ChecklistItem
              item={item}
              index={i}
              total={total}
              readOnly={readOnly}
              onToggle={(c) => onToggleItem(item.id, c)}
            />
          </div>
        );
      })}
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="w-full" onClick={(e) => e.stopPropagation()} role="presentation">
        {header}
        {open && <div className="mt-2 border-t border-border pt-2">{body}</div>}
      </div>
    );
  }

  return (
    <Card className="max-lg:glass max-lg:rounded-[22px]">
      <CardContent className="p-4 sm:p-5">
        {header}
        {open && <div className="mt-3 border-t border-border pt-2">{body}</div>}
      </CardContent>
    </Card>
  );
}
