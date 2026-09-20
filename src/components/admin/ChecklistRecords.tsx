import { useState } from "react";
import { Check, Circle, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { checklistProgress, type ChecklistSnapshotItem } from "@/domain/checklists";
import { completionLabel, type ChecklistRecord } from "@/lib/checklist-records";
import { berlinClock } from "@/lib/push-time";
import { recordState, visibleChecklistRecords, type RecordState } from "./checklist-records-view";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
type Detail = { title: string; items: ChecklistSnapshotItem[]; headings: boolean; time: string };

function StateBadge({ state }: { state: RecordState }) {
  const label =
    state === "complete" ? "Completed" : state === "in-progress" ? "In Progress" : "Not Started";
  return (
    <Badge
      variant="secondary"
      className={
        state === "complete"
          ? "border-transparent bg-done-soft text-done"
          : state === "in-progress"
            ? "border-transparent bg-live-soft text-live"
            : "border-transparent bg-muted text-muted-foreground"
      }
    >
      {label}
    </Badge>
  );
}

function ProgressValue({ items }: { items: ChecklistSnapshotItem[] }) {
  const progress = checklistProgress(items);
  return (
    <span
      className={
        progress.complete
          ? "inline-flex items-center gap-1 font-medium text-done"
          : progress.completed > 0
            ? "font-medium text-live"
            : "text-muted-foreground"
      }
    >
      {progress.complete && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      <span className="tabular-nums">
        {progress.completed} / {progress.total}
      </span>
    </span>
  );
}

export function HistoricalChecklistItems({
  items,
  headings,
}: {
  items: ChecklistSnapshotItem[];
  headings: boolean;
}) {
  return (
    <ol className="divide-y divide-border">
      {items.map((item, index) => (
        <li key={item.id} className="py-3">
          {headings && item.heading && item.heading !== items[index - 1]?.heading && (
            <h4 className="pb-3 pt-2 text-sm font-semibold">{item.heading}</h4>
          )}
          <div className="flex items-start gap-3">
            {item.completed ? (
              <Check aria-label="Completed" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            ) : (
              <Circle
                aria-label="Not completed"
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              />
            )}
            <div className="min-w-0 flex-1 text-sm break-words">{item.text}</div>
            <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {completionLabel(item)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function RecordExpansion({ record }: { record: ChecklistRecord }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const snapshot = record.checklists;
  if (!snapshot)
    return (
      <p className="py-5 text-sm text-muted-foreground">
        Checklist data unavailable for this shift.
      </p>
    );
  const summary = (
    title: string,
    items: ChecklistSnapshotItem[],
    headings: boolean,
    time: string,
  ) => {
    const progress = checklistProgress(items);
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-border bg-background px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h4 className="text-sm font-medium">{title}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {progress.complete
              ? "All checklist items completed"
              : progress.completed > 0
                ? `${progress.completed} of ${progress.total} completed`
                : "Not completed"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <ProgressValue items={items} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDetail({ title, items, headings, time })}
          >
            View Checklist
          </Button>
        </div>
      </div>
    );
  };
  return (
    <div className="space-y-4 bg-surface-raised px-3 py-4 sm:px-5">
      <section aria-labelledby={`start-${record.id}`}>
        <h3
          id={`start-${record.id}`}
          className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground"
        >
          Shift Start Checklist
        </h3>
        {summary(
          "Shift Start Checklist",
          snapshot.start.items,
          false,
          berlinClock(new Date(record.check_in_at)),
        )}
      </section>

      <section aria-labelledby={`classes-${record.id}`}>
        <h3
          id={`classes-${record.id}`}
          className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground"
        >
          Class Checklists
        </h3>
        {snapshot.classes.length === 0 ? (
          <p className="border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
            No class checklists.
          </p>
        ) : (
          <div className="overflow-hidden border border-border bg-background">
            <div className="hidden grid-cols-[0.85fr_1.45fr_1.15fr_0.75fr_0.7fr_auto] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground md:grid">
              <span>Time</span>
              <span>Class</span>
              <span>Teacher</span>
              <span>Type</span>
              <span>Progress</span>
              <span className="sr-only">Action</span>
            </div>
            {snapshot.classes.map((cls) => (
              <div
                key={cls.classId}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-border px-3 py-3 last:border-b-0 md:grid-cols-[0.85fr_1.45fr_1.15fr_0.75fr_0.7fr_auto] md:items-center md:py-2.5"
              >
                <span className="col-span-2 text-xs tabular-nums text-muted-foreground md:col-span-1 md:text-sm">
                  {cls.startTime}–{cls.endTime}
                </span>
                <span className="col-span-2 min-w-0 break-words text-sm font-medium md:col-span-1 md:font-normal">
                  {cls.className}
                </span>
                <span className="col-span-2 min-w-0 break-words text-xs text-muted-foreground md:col-span-1 md:text-sm md:text-foreground">
                  {cls.teacherName}
                </span>
                <div className="col-span-2 flex flex-wrap items-center gap-1.5 md:col-span-1">
                  <Badge variant="secondary" className="font-medium capitalize">
                    {cls.type}
                  </Badge>
                  {cls.status === "cancelled" && <Badge variant="outline">Cancelled</Badge>}
                </div>
                <span className="col-span-2 md:col-span-1">
                  <ProgressValue items={cls.items} />
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="col-span-2 justify-self-start md:col-span-1 md:justify-self-end"
                  onClick={() =>
                    setDetail({
                      title: cls.type === "ballet" ? "Ballet Checklist" : "Workout Checklist",
                      items: cls.items,
                      headings: true,
                      time: cls.startTime,
                    })
                  }
                >
                  View Checklist
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby={`end-${record.id}`}>
        <h3
          id={`end-${record.id}`}
          className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground"
        >
          End of Shift Checklist
        </h3>
        {summary(
          "End of Shift Checklist",
          snapshot.end.items,
          false,
          record.check_out_at ? berlinClock(new Date(record.check_out_at)) : "Open shift",
        )}
      </section>
      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription>
              {record.operator_name} · {formatDate(record.check_in_at)} · {detail?.time}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <p className="text-sm text-muted-foreground">
                {checklistProgress(detail.items).completed} / {detail.items.length}
              </p>
              <HistoricalChecklistItems items={detail.items} headings={detail.headings} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ChecklistRecords({ records }: { records: ChecklistRecord[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const visibleRecords = visibleChecklistRecords(records);
  return (
    <div className="overflow-hidden border border-border">
      <div className="hidden grid-cols-[1.25fr_0.8fr_1fr_0.75fr] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[10px] font-semibold uppercase text-muted-foreground sm:grid">
        <span>Date</span>
        <span>Operator</span>
        <span>Shift Timing</span>
        <span>Status</span>
      </div>
      {visibleRecords.map((record) => (
        <div key={record.id} className="border-b border-border">
          <Button
            variant="ghost"
            aria-expanded={expanded === record.id}
            onClick={() => setExpanded(expanded === record.id ? null : record.id)}
            className="grid h-auto min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-none px-3 py-2.5 text-left text-xs font-normal whitespace-normal hover:bg-muted/40 sm:grid-cols-[1.25fr_0.8fr_1fr_0.75fr] sm:px-4 sm:text-sm"
          >
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              {expanded === record.id ? (
                <ChevronDown className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0" />
              )}
              {formatDate(record.check_in_at)}
            </span>
            <span className="min-w-0 break-words text-right sm:text-left">
              {record.operator_name}
            </span>
            <span className="pl-[18px] tabular-nums text-muted-foreground sm:pl-0 sm:text-foreground">
              {berlinClock(new Date(record.check_in_at))} –{" "}
              {record.check_out_at ? berlinClock(new Date(record.check_out_at)) : "Open"}
            </span>
            <span className="justify-self-end sm:justify-self-start">
              <StateBadge state={recordState(record)} />
            </span>
          </Button>
          {expanded === record.id && <RecordExpansion record={record} />}
        </div>
      ))}
    </div>
  );
}
