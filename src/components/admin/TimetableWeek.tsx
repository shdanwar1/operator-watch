/**
 * Live Timetable presentation (Operation 5).
 *
 * Presentation only: it receives a fully resolved week and renders it. No data
 * fetching, no database access, no DMC API knowledge.
 */
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { resumesOnLabel, type TimetableCard, type TimetableDay } from "@/domain/timetable-view";

function InstructorAvatar({ card }: { card: TimetableCard }) {
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

function SlotCard({ card }: { card: TimetableCard }) {
  const resumes = resumesOnLabel(card.resumesOn);
  return (
    <li
      className={cn(
        "rounded-lg border border-border bg-card p-3",
        !card.active && "border-dashed bg-muted/40",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
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
        <span className="text-[11px] text-muted-foreground">{card.durationMinutes} min</span>
      </div>

      <p className={cn("mt-1 text-sm font-medium", !card.active && "text-muted-foreground")}>
        {card.className}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <InstructorAvatar card={card} />
        <span className="truncate text-xs text-muted-foreground">{card.instructorName}</span>
      </div>

      {(card.category || card.level) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.category && (
            <Badge variant="secondary" className="text-[10px] font-normal capitalize">
              {card.category}
            </Badge>
          )}
          {card.level && (
            <Badge variant="outline" className="text-[10px] font-normal capitalize">
              {card.level}
            </Badge>
          )}
        </div>
      )}

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

export function TimetableWeek({ week }: { week: TimetableDay[] }) {
  return (
    <div className="grid min-w-[1000px] grid-cols-7 gap-3">
      {week.map((day) => (
        <section key={day.dayLocal} aria-label={day.label} className="min-w-0">
          <h2 className="mb-2 border-b border-border pb-2 text-[13px] font-semibold tracking-tight">
            {day.label}
          </h2>
          {day.cards.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No classes</p>
          ) : (
            <ul className="space-y-2">
              {day.cards.map((card) => (
                <SlotCard key={card.sourceSlotId} card={card} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
