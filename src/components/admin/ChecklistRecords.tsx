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

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
type Detail = { title: string; items: ChecklistSnapshotItem[]; headings: boolean; time: string };

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
  const entry = (
    title: string,
    items: ChecklistSnapshotItem[],
    headings: boolean,
    time: string,
  ) => {
    const progress = checklistProgress(items);
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium">{title}</h4>
          <span className="text-xs text-muted-foreground">
            {progress.completed} / {progress.total}
            {progress.complete ? " ✓" : ""}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDetail({ title, items, headings, time })}
        >
          View Checklist
        </Button>
      </div>
    );
  };
  return (
    <div className="py-2">
      {entry(
        "Start Shift Checklist",
        snapshot.start.items,
        false,
        berlinClock(new Date(record.check_in_at)),
      )}
      <h3 className="border-t border-border pt-4 text-xs font-semibold uppercase text-muted-foreground">
        Classes
      </h3>
      {snapshot.classes.length === 0 && (
        <p className="py-3 text-sm text-muted-foreground">No class checklists.</p>
      )}
      {snapshot.classes.map((cls) => (
        <div key={cls.classId} className="border-b border-border py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="tabular-nums text-muted-foreground">
              {cls.startTime} – {cls.endTime}
            </span>
            <span className="font-medium break-words">{cls.className}</span>
            {cls.status === "cancelled" && <Badge variant="secondary">Cancelled</Badge>}
          </div>
          <p className="pt-1 text-xs text-muted-foreground">{cls.teacherName}</p>
          {entry(
            cls.type === "ballet" ? "Ballet Checklist" : "Workout Checklist",
            cls.items,
            true,
            cls.startTime,
          )}
        </div>
      ))}
      {entry(
        "End Shift Checklist",
        snapshot.end.items,
        false,
        record.check_out_at ? berlinClock(new Date(record.check_out_at)) : "Open shift",
      )}
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
  return (
    <div>
      <div className="grid grid-cols-[1.1fr_0.8fr_1.1fr] gap-2 border-b border-border py-3 text-xs font-medium text-muted-foreground">
        <span>Date</span>
        <span>Operator</span>
        <span>Shift Timing</span>
      </div>
      {records.map((record) => (
        <div key={record.id} className="border-b border-border">
          <Button
            variant="ghost"
            aria-expanded={expanded === record.id}
            onClick={() => setExpanded(expanded === record.id ? null : record.id)}
            className="grid h-auto min-h-16 w-full grid-cols-[1.1fr_0.8fr_1.1fr] gap-2 rounded-none px-0 py-3 text-left text-xs font-normal whitespace-normal sm:text-sm"
          >
            <span className="flex min-w-0 items-center gap-1">
              {expanded === record.id ? (
                <ChevronDown className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0" />
              )}
              {formatDate(record.check_in_at)}
            </span>
            <span className="min-w-0 break-words">{record.operator_name}</span>
            <span className="tabular-nums">
              {berlinClock(new Date(record.check_in_at))} –{" "}
              {record.check_out_at ? berlinClock(new Date(record.check_out_at)) : "Open"}
            </span>
          </Button>
          {expanded === record.id && <RecordExpansion record={record} />}
        </div>
      ))}
    </div>
  );
}
