import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Trash2, XCircle } from "lucide-react";
import type { ScheduledShiftRow } from "@/lib/shifts.functions";
import type { OperatorBasic } from "@/lib/operators.functions";
import {
  addDays,
  fmtTime12,
  minutesBetween,
  fmtHours,
  opColor,
  timeToMinutes,
  type Assignment,
} from "@/lib/admin-utils";

/** Compact shift chip used in the admin calendar grids. */
export function ShiftCard({ shift, onClick }: { shift: Assignment; onClick: () => void }) {
  const c = opColor(shift.assigned_operator);
  const cancelled = shift.effective_status === "cancelled";
  const completed = shift.effective_status === "completed";
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg border p-2 text-left transition hover:shadow-sm ${
        shift.assigned_operator
          ? `${c?.bg ?? ""} ${c?.border ?? ""}`
          : "border-dashed border-muted-foreground/40 bg-muted/30"
      } ${cancelled ? "opacity-50 line-through" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        {shift.assigned_operator ? (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${c?.dot}`} />
            <span className={`truncate ${c?.text}`}>{shift.assigned_operator}</span>
          </>
        ) : (
          <span className="truncate text-muted-foreground">Unassigned</span>
        )}
        {completed && <CheckCircle2 className="ml-auto h-3 w-3 text-emerald-500" />}
        {cancelled && <XCircle className="ml-auto h-3 w-3 text-muted-foreground" />}
      </div>
      <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {fmtTime12(shift.start_time)} – {fmtTime12(shift.end_time)}
      </div>
      {completed && (
        <div className="mt-0.5 truncate text-[10px] font-medium text-emerald-500">✓ Completed</div>
      )}
      {shift.label && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{shift.label}</div>
      )}
    </button>
  );
}

/**
 * Shift editor. `canReassign` is driven by role: admins may change the
 * operator, operators never see the field at all.
 */
export function ShiftEditSheet({
  shift,
  operators,
  sameDayShifts,
  canReassign,
  onClose,
  onAssign,
  onDelete,
  onSave,
}: {
  shift: ScheduledShiftRow | null;
  operators: OperatorBasic[];
  /** Other shifts on the same calendar day, for the overlap hint. */
  sameDayShifts: Assignment[];
  canReassign: boolean;
  onClose: () => void;
  onAssign: (id: string, op: string | null, status?: string) => void;
  onDelete: (id: string) => void;
  onSave: (patch: {
    start_time?: string;
    end_time?: string;
    label?: string;
    specific_date?: string;
    assigned_operator?: string | null;
    status?: string;
    notes?: string | null;
  }) => Promise<void>;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [op, setOp] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    if (shift) {
      setStart(shift.start_time.slice(0, 5));
      setEnd(shift.end_time.slice(0, 5));
      setLabel(shift.label ?? "");
      setNotes(shift.notes ?? "");
      setDate(shift.specific_date ?? "");
      setOp(shift.assigned_operator ?? "");
      setStatus(shift.status ?? "assigned");
    }
  }, [shift]);

  const conflictInfo = useMemo(() => {
    if (!shift || !op) return null;
    const startMin = timeToMinutes(start || "00:00");
    const endMin = timeToMinutes(end || "00:00");
    let opTotalMin = 0;
    let overlap: Assignment | null = null;
    for (const s of sameDayShifts) {
      if (s.id === shift.id) continue;
      if (s.assigned_operator !== op) continue;
      opTotalMin += minutesBetween(s.start_time, s.end_time);
      const sStart = timeToMinutes(s.start_time);
      const sEnd = timeToMinutes(s.end_time);
      if (startMin < sEnd && endMin > sStart) overlap = s;
    }
    return { overlap, opTotalMin };
  }, [shift, op, start, end, sameDayShifts]);

  if (!shift) return null;

  return (
    <Sheet open={!!shift} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit shift</SheetTitle>
          <SheetDescription>
            {new Date(`${shift.specific_date}T00:00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}{" "}
            · {fmtTime12(shift.start_time)}–{fmtTime12(shift.end_time)}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-14rem)] pr-2">
          <div className="space-y-4">
            {canReassign && (
              <div className="space-y-1.5">
                <Label>Operator</Label>
                <Select value={op || "__none"} onValueChange={(v) => setOp(v === "__none" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select operator" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— Unassigned —</SelectItem>
                    {operators
                      .filter((o) => o.is_active)
                      .map((o) => {
                        const c = opColor(o.username);
                        return (
                          <SelectItem key={o.id} value={o.username}>
                            <span className="inline-flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${c?.dot}`} />
                              {o.username}
                            </span>
                          </SelectItem>
                        );
                      })}
                  </SelectContent>
                </Select>
              </div>
            )}

            {canReassign && op && conflictInfo && (
              <div
                className={`rounded-lg border p-3 text-xs ${
                  conflictInfo.overlap
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : "border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {conflictInfo.overlap ? (
                  <>
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5" /> Overlaps another shift
                    </div>
                    <div className="mt-1">
                      {fmtTime12(conflictInfo.overlap.start_time)}–
                      {fmtTime12(conflictInfo.overlap.end_time)}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Good assignment
                  </div>
                )}
                <div className="mt-1 text-muted-foreground">
                  {op} total on this day (incl. this shift):{" "}
                  {fmtHours(conflictInfo.opTotalMin + minutesBetween(start, end))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start</Label>
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Morning shift"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  onSave({
                    start_time: start,
                    end_time: end,
                    label,
                    specific_date: date || undefined,
                    notes: notes || null,
                    ...(canReassign ? { assigned_operator: op || null } : {}),
                    status,
                  })
                }
              >
                Save changes
              </Button>
              {canReassign && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAssign(shift.id, null, "unassigned")}
                >
                  Unassign
                </Button>
              )}
              <Button size="sm" variant="destructive" onClick={() => onDelete(shift.id)}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/** Admin: create one or more scheduled shifts. */
export function CreateShiftDialog({
  open,
  onOpenChange,
  selectedDate,
  operators,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedDate: Date | null;
  operators: OperatorBasic[];
  onCreate: (
    input: {
      start_time: string;
      end_time: string;
      label: string;
      assigned_operator: string | null;
      notes: string | null;
    },
    dates: string[],
  ) => Promise<void>;
}) {
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("13:00");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [op, setOp] = useState<string>("");
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setRepeat(false);
      setWeeks(4);
    }
  }, [open]);

  const baseDate = selectedDate ?? new Date();
  const occurrences = repeat ? Math.max(1, Math.min(52, weeks)) : 1;
  const dates = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < occurrences; i++) out.push(addDays(baseDate, i * 7));
    return out;
  }, [baseDate, occurrences]);

  const ymdLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const submit = async () => {
    setSubmitting(true);
    try {
      await onCreate(
        {
          start_time: start,
          end_time: end,
          label,
          assigned_operator: op || null,
          notes: notes || null,
        },
        dates.map(ymdLocal),
      );
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New shift</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            {baseDate.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Operator</Label>
            <Select value={op || "__none"} onValueChange={(v) => setOp(v === "__none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Unassigned —</SelectItem>
                {operators
                  .filter((o) => o.is_active)
                  .map((o) => (
                    <SelectItem key={o.id} value={o.username}>
                      {o.username}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Morning shift"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <input
              id="repeat-weekly"
              type="checkbox"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
            />
            <Label htmlFor="repeat-weekly" className="cursor-pointer text-sm">
              Repeat weekly
            </Label>
            {repeat && (
              <Input
                type="number"
                min={1}
                max={52}
                value={weeks}
                onChange={(e) => setWeeks(Number(e.target.value))}
                className="ml-auto h-8 w-20"
              />
            )}
          </div>
          {repeat && (
            <Badge variant="outline" className="text-[11px]">
              Creates {dates.length} shifts
            </Badge>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
