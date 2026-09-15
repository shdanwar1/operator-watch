/**
 * Current-week operator board presentation.
 *
 * Presentation only: it receives a fully resolved week and renders it. No data
 * fetching, no database access, no DMC API knowledge.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { opColor } from "@/lib/admin-utils";
import { resumesOnLabel } from "@/domain/timetable-view";
import type { BoardCard, BoardDay } from "@/domain/timetable-week";

function OperatorLine({ card }: { card: BoardCard }) {
  const color = card.assigned ? opColor(card.operatorName) : null;
  const label = card.assigned ? card.operatorName : "Unassigned";
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          color ? color.dot : "bg-muted-foreground/40",
        )}
      />
      <span
        className={cn(
          "truncate text-[11px] font-medium leading-none",
          card.assigned ? (color?.text ?? "text-foreground") : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

function SlotCard({ card }: { card: BoardCard }) {
  const resumes = resumesOnLabel(card.resumesOn);
  return (
    <li
      className={cn(
        "rounded-md border border-border/80 bg-card/60 px-2.5 py-2",
        !card.active && "border-dashed border-border bg-muted/25",
      )}
    >
      <span
        className={cn(
          "block text-[11px] font-medium leading-none tabular-nums text-muted-foreground",
          !card.active && "text-muted-foreground",
        )}
      >
        {card.startTime}–{card.endTime}
        {card.endsNextDay && (
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">next day</span>
        )}
      </span>

      <p
        className={cn(
          "mt-1.5 text-[13px] font-semibold leading-[1.25] text-foreground",
          !card.active && "text-muted-foreground",
        )}
      >
        {card.className}
      </p>

      <p className="mt-1 truncate text-[11px] leading-tight text-muted-foreground">
        {card.instructorName}
      </p>

      <OperatorLine card={card} />

      {!card.active && (
        <p className="mt-1.5 text-[10px] font-medium leading-tight text-muted-foreground">
          Suspended{resumes ? ` · ${resumes}` : ""}
        </p>
      )}
    </li>
  );
}

export function TimetableWeekSkeleton() {
  return (
    <div className="grid min-w-[1000px] grid-cols-7 gap-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}

export function TimetableWeek({ week }: { week: BoardDay[] }) {
  return (
    <div className="grid min-w-[1000px] grid-cols-7 gap-2">
      {week.map((day) => (
        <section key={day.date} aria-label={`${day.weekday} ${day.dateLabel}`} className="min-w-0">
          <h2 className="mb-1.5 border-b border-border/80 pb-1.5">
            <span className="block text-[11px] font-semibold uppercase leading-tight text-foreground">
              {day.weekday}
            </span>
            <span className="mt-0.5 block text-[11px] font-normal leading-tight text-muted-foreground">
              {day.dateLabel}
            </span>
          </h2>
          {day.cards.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No classes</p>
          ) : (
            <ul className="space-y-1.5">
              {day.cards.map((card) => (
                <SlotCard key={`${card.date}-${card.sourceSlotId}`} card={card} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
