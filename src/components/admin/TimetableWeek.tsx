/**
 * Current-week operator board presentation.
 *
 * Presentation only: it receives a fully resolved week and renders it. No data
 * fetching, no database access, no DMC API knowledge.
 */
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { opColor } from "@/lib/admin-utils";
import { resumesOnLabel } from "@/domain/timetable-view";
import type { BoardCard, BoardDay } from "@/domain/timetable-week";

function InstructorAvatar({ card }: { card: BoardCard }) {
  if (card.instructorImageUrl) {
    return (
      <img
        src={card.instructorImageUrl}
        alt=""
        loading="lazy"
        className="h-6 w-6 shrink-0 rounded-full object-cover"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
    >
      {card.instructorInitials}
    </span>
  );
}

function OperatorLine({ card }: { card: BoardCard }) {
  const color = card.assigned ? opColor(card.operatorName) : null;
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          color ? color.dot : "bg-muted-foreground/40",
        )}
      />
      <span
        className={cn(
          "truncate text-[11px] font-medium",
          card.assigned ? (color?.text ?? "text-foreground") : "text-muted-foreground",
        )}
      >
        {card.assigned ? card.operatorName : "Unassigned"}
      </span>
    </div>
  );
}

function SlotCard({ card }: { card: BoardCard }) {
  const resumes = resumesOnLabel(card.resumesOn);
  return (
    <li
      className={cn(
        "rounded-lg border border-border bg-card p-3",
        !card.active && "border-dashed bg-muted/40",
      )}
    >
      <span
        className={cn(
          "text-[13px] font-semibold tabular-nums",
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
          "mt-1 text-sm font-medium leading-snug",
          !card.active && "text-muted-foreground",
        )}
      >
        {card.className}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <InstructorAvatar card={card} />
        <span className="truncate text-xs text-muted-foreground">{card.instructorName}</span>
      </div>

      {card.displayCategory && (
        <div className="mt-2">
          <Badge
            variant={card.displayCategory === "Ballet" ? "outline" : "secondary"}
            className="text-[10px] font-normal"
          >
            {card.displayCategory}
          </Badge>
        </div>
      )}

      <OperatorLine card={card} />

      {!card.active && (
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">
          Suspended{resumes ? ` · ${resumes}` : ""}
        </p>
      )}
    </li>
  );
}

export function TimetableWeekSkeleton() {
  return (
    <div className="grid grid-cols-7 gap-3 min-w-[1000px]">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ))}
    </div>
  );
}

export function TimetableWeek({ week }: { week: BoardDay[] }) {
  return (
    <div className="grid min-w-[1000px] grid-cols-7 gap-3">
      {week.map((day) => (
        <section key={day.date} aria-label={`${day.weekday} ${day.dateLabel}`} className="min-w-0">
          <h2 className="mb-2 border-b border-border pb-2 text-[13px] font-semibold tracking-tight">
            {day.weekday}
            <span className="ml-1.5 font-normal text-muted-foreground">{day.dateLabel}</span>
          </h2>
          {day.cards.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No classes</p>
          ) : (
            <ul className="space-y-2">
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
