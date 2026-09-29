// Monthly attendance totals + history table with expandable per-shift details
// (classes + notes). Owns the full worked-shift dataset for the Record screen:
// the former separate Shift Log section is folded into these rows.
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { operatorNamespace, readCache, writeCache } from "@/lib/local-cache";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  listShifts,
  listScheduledShifts,
  updateShift as updateShiftFn,
  deleteShift as deleteShiftFn,
  createPastShift as createPastShiftFn,
  type ShiftRow,
  type ScheduledShiftRow,
  type ShiftClass,
} from "@/lib/shifts.functions";
import { listDmcDirectory, type DmcOption } from "@/lib/dmc-directory.functions";
import {
  summarizeMonth,
  formatHM,
  formatDiff,
  CATEGORY_LABEL,
  CATEGORY_COLOR,
  type AttendanceRow,
  type HourCategory,
} from "@/lib/attendance";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { downloadAttendancePdf } from "@/lib/attendance-pdf";
import { DmcPicker } from "@/components/DmcPicker";

/** A worked shift, as needed by the Edit/Add dialogs. */
type Shift = {
  id: string;
  operator_name: string;
  check_in_at: string;
  check_out_at: string | null;
  live_streams_count: number;
  notes: string | null;
  scheduled_shift_id: string | null;
  classes: ShiftClass[];
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(v).toISOString();
}

function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Selecting from the DMC directory stores the canonical id and keeps the name
 * alongside it purely as a display snapshot.
 */
const pickDmcClass = (o: DmcOption | null): Partial<ShiftClass> => ({
  dmcClassId: o?.id ?? null,
  class: o?.name ?? "",
});
const pickDmcInstructor = (o: DmcOption | null): Partial<ShiftClass> => ({
  dmcInstructorId: o?.id ?? null,
  teacher: o?.name ?? "",
});

const emptyClass = (): ShiftClass => ({
  class: "",
  teacher: "",
  dmcClassId: null,
  dmcInstructorId: null,
});

export function AttendanceSection({ username }: { username: string | null }) {
  const fetchShifts = useServerFn(listShifts);
  const fetchScheduled = useServerFn(listScheduledShifts);
  const fetchDmcDirectory = useServerFn(listDmcDirectory);
  const updateShiftServer = useServerFn(updateShiftFn);
  const deleteShiftServer = useServerFn(deleteShiftFn);
  const createPastServer = useServerFn(createPastShiftFn);

  type EarningsSnapshot = {
    shifts: ShiftRow[];
    scheduled: ScheduledShiftRow[];
    teachers: DmcOption[];
    classDir: DmcOption[];
  };
  const earningsCacheKey = username ? `${operatorNamespace(username)}earnings` : null;
  const [cachedEarnings] = useState<EarningsSnapshot | null>(() =>
    earningsCacheKey ? readCache<EarningsSnapshot>(earningsCacheKey) : null,
  );

  const [shifts, setShifts] = useState<ShiftRow[]>(cachedEarnings?.shifts ?? []);
  const [scheduled, setScheduled] = useState<ScheduledShiftRow[]>(cachedEarnings?.scheduled ?? []);
  const [teachers, setTeachers] = useState<DmcOption[]>(cachedEarnings?.teachers ?? []);
  const [classDir, setClassDir] = useState<DmcOption[]>(cachedEarnings?.classDir ?? []);
  const [loading, setLoading] = useState(!cachedEarnings);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [addingPast, setAddingPast] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Only the very first load shows the full-page "Loading…" state. Every
  // later refresh updates the already-visible content in place instead of
  // blanking the page on every event.
  const hasLoadedOnce = useRef(!!cachedEarnings);
  async function load() {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const [s, sc, dmc] = await Promise.all([
        fetchShifts(),
        fetchScheduled(),
        fetchDmcDirectory(),
      ]);
      setShifts(s);
      setScheduled(sc);
      setTeachers(dmc.instructors);
      setClassDir(dmc.classes);
      if (earningsCacheKey)
        writeCache<EarningsSnapshot>(earningsCacheKey, {
          shifts: s,
          scheduled: sc,
          teachers: dmc.instructors,
          classDir: dmc.classes,
        });
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true;
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Shift tables are not exposed to client realtime (per-operator data locked
  // down by RLS); refresh on a timer and when the tab regains focus instead.
  // Debounced so a burst of triggers collapses into one refresh.
  const debouncedLoad = useDebouncedCallback(() => load(), 700);
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) debouncedLoad();
    }, 90_000);
    const onFocus = () => debouncedLoad();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [debouncedLoad]);

  const [monthStart, setMonthStart] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const isCurrentMonth = useMemo(() => {
    const n = new Date();
    return monthStart.getFullYear() === n.getFullYear() && monthStart.getMonth() === n.getMonth();
  }, [monthStart]);
  const shiftMonth = (delta: number) =>
    setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  const summary = useMemo(
    () => summarizeMonth(shifts, scheduled, monthStart),
    [shifts, scheduled, monthStart],
  );

  // Look up a raw shift row by id so the Edit dialog gets check_in/check_out ISOs.
  const shiftsById = useMemo(() => {
    const m = new Map<string, ShiftRow>();
    for (const s of shifts) m.set(s.id, s);
    return m;
  }, [shifts]);

  // Class and teacher identity now comes from the DMC directory, so there is no
  // separate usage directory to keep warm any more.

  async function saveEdit(next: Shift) {
    try {
      await updateShiftServer({
        data: {
          id: next.id,
          patch: {
            check_in_at: next.check_in_at,
            check_out_at: next.check_out_at,
            classes: next.classes,
            notes: next.notes,
          },
        },
      });

      toast.success("Shift updated");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function deleteShift(id: string) {
    try {
      await deleteShiftServer({ data: { id } });
      toast.success("Deleted");
      setExpanded((e) => {
        const next = { ...e };
        delete next[id];
        return next;
      });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function addPast(payload: {
    check_in_at: string;
    check_out_at: string;
    classes: ShiftClass[];
    notes: string | null;
  }) {
    try {
      await createPastServer({ data: payload });

      toast.success("Past shift added");
      setAddingPast(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    }
  }

  function startEdit(row: AttendanceRow) {
    const raw = shiftsById.get(row.id);
    setEditing({
      id: row.id,
      operator_name: row.operator_name,
      check_in_at: raw?.check_in_at ?? row.checkIn.toISOString(),
      check_out_at: raw?.check_out_at ?? row.checkOut.toISOString(),
      live_streams_count: row.classes.length,
      notes: row.notes,
      scheduled_shift_id: row.scheduled_shift_id,
      classes: row.classes,
    });
  }

  function exportPdf() {
    downloadAttendancePdf(summary, username ?? "Operator");
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium tabular-nums">
            {summary.monthLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftMonth(1)}
            disabled={isCurrentMonth}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-6">
          {/* Attendance history */}
          <Card className="border-border/60 shadow-sm max-lg:glass max-lg:rounded-[22px]">
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-6 max-lg:p-4">
                <div>
                  <h2 className="text-sm font-semibold">Attendance · {summary.monthLabel}</h2>
                  <p className="text-xs text-muted-foreground">
                    {summary.rows.length} shift{summary.rows.length === 1 ? "" : "s"} this month
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAddingPast(true)}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add past shift
                  </Button>
                  <Button size="sm" onClick={exportPdf} disabled={summary.rows.length === 0}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export PDF
                  </Button>
                </div>
              </div>

              {/* Mobile: one row per shift instead of a horizontally scrolling table. */}
              <div className="md:hidden">
                {summary.rows.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No completed shifts yet this month.
                  </p>
                ) : (
                    <ul>
                      {summary.rows.map((r) => (
                        <AttendanceMobileRow
                          key={r.id}
                          row={r}
                          expanded={!!expanded[r.id]}
                          onToggle={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}
                          onEdit={() => startEdit(r)}
                          onDelete={() => deleteShift(r.id)}
                        />
                      ))}
                    </ul>
                )}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-8 px-2 py-3" />
                      <th className="px-5 py-3 text-left">Date</th>
                      <th className="px-5 py-3 text-left">Scheduled</th>
                      <th className="px-5 py-3 text-left">Check in</th>
                      <th className="px-5 py-3 text-left">Check out</th>
                      <th className="px-5 py-3 text-right">Worked</th>
                      <th className="px-5 py-3 text-right">Diff</th>
                      <th className="px-5 py-3 text-center">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {summary.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-5 py-10 text-center text-sm text-muted-foreground"
                        >
                          No completed shifts yet this month.
                        </td>
                      </tr>
                    ) : (
                      summary.rows.map((r) => (
                        <AttendanceTableRow
                          key={r.id}
                          row={r}
                          expanded={!!expanded[r.id]}
                          onToggle={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}
                          onEdit={() => startEdit(r)}
                          onDelete={() => deleteShift(r.id)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {summary.rows.length > 0 && (
                <AttendanceSummaryFooter summary={summary} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <EditDialog
        shift={editing}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
        teachers={teachers}
        classDir={classDir}
      />

      <AddPastDialog
        open={addingPast}
        onClose={() => setAddingPast(false)}
        onSave={addPast}
        teachers={teachers}
        classDir={classDir}
      />
    </section>
  );
}

/**
 * Integrated summary footer — sits directly below the shift rows inside the
 * attendance card. Mirrors the reference design: "Total Hours" label on the
 * left, Day / Night / Weekend breakdowns separated by vertical dividers, and
 * the grand total in a highlighted box on the right.
 */
function AttendanceSummaryFooter({ summary }: { summary: ReturnType<typeof summarizeMonth> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-muted/20 px-5 py-3.5 max-lg:px-4 max-lg:py-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
        Total Hours
      </span>
      <div className="flex flex-1 items-stretch gap-x-4 min-w-[180px]">
        <SummaryCell label="Day Hours" value={formatHM(summary.dayMin)} />
        <SummaryCell label="Night Hours" value={formatHM(summary.nightMin)} divided />
        <SummaryCell label="Weekend Hours" value={formatHM(summary.weekendMin)} divided />
      </div>
      <div className="rounded-lg bg-muted/50 px-4 py-1.5 max-lg:px-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</div>
        <div className="text-base font-bold tabular-nums text-foreground max-lg:text-sm">
          {formatHM(summary.workedMin)}
        </div>
      </div>
    </div>
  );
}

function SummaryCell({ label, value, divided = false }: { label: string; value: string; divided?: boolean }) {
  return (
    <div className={`flex flex-col justify-center px-4 first:pl-0 max-lg:px-3 ${divided ? "border-l border-border" : ""}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/** Shared expandable detail panel: classes (class + teacher) + notes + actions. */
function ShiftDetailPanel({
  row,
  onEdit,
  onDelete,
}: {
  row: AttendanceRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="px-4 pb-4 pt-3 md:px-5">
      {row.classes.length > 0 ? (
        <>
          {/* Mobile: a plain divided list. */}
          <ul className="md:hidden">
            {row.classes.map((c, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
              >
                <span className="min-w-0 truncate text-[12px] font-medium">
                  {c.class || <span className="text-muted-foreground">—</span>}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {c.teacher || "—"}
                </span>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-md border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Class</th>
                  <th className="px-3 py-1.5 text-left font-medium">Teacher</th>
                </tr>
              </thead>
              <tbody>
                {row.classes.map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5">
                      {c.class || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      {c.teacher || <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No classes logged.</p>
      )}
      {row.notes && <p className="mt-2 text-sm italic text-muted-foreground">"{row.notes}"</p>}
      <div className="mt-3 flex justify-end gap-1 max-md:mt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          aria-label="Edit shift"
          className="max-md:h-9 max-md:w-9 max-md:p-0"
        >
          <Pencil className="h-3.5 w-3.5 md:mr-1" />
          <span className="max-md:hidden">Edit</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          aria-label="Delete shift"
          className="max-md:h-9 max-md:w-9"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function AttendanceTableRow({
  row,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  row: AttendanceRow;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const diffColor =
    row.diffMin == null
      ? "text-muted-foreground"
      : row.diffMin > 0
        ? "text-emerald-600"
        : row.diffMin < 0
          ? "text-rose-600"
          : "text-muted-foreground";
  return (
    <>
      <tr>
        <td className="px-2 py-3 align-middle">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label="Toggle shift details"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </td>
        <td className="px-5 py-3">{fmtDate(row.date)}</td>
        <td className="px-5 py-3 tabular-nums text-muted-foreground">
          {row.scheduledStart && row.scheduledEnd
            ? `${fmtTime(row.scheduledStart)}–${fmtTime(row.scheduledEnd)}`
            : "—"}
        </td>
        <td className="px-5 py-3 tabular-nums">{fmtTime(row.checkIn)}</td>
        <td className="px-5 py-3 tabular-nums">{fmtTime(row.checkOut)}</td>
        <td className="px-5 py-3 text-right tabular-nums">{formatHM(row.workedMin)}</td>
        <td className={`px-5 py-3 text-right tabular-nums ${diffColor}`}>
          {row.diffMin != null ? formatDiff(row.diffMin) : "—"}
        </td>
        <td className="px-5 py-3">
          <div className="flex flex-wrap items-center justify-center gap-1">
            {(row.categories.length ? row.categories : [row.primary]).map((c) => (
              <Badge
                key={c}
                variant="secondary"
                className="border-0 text-white"
                style={{ backgroundColor: CATEGORY_COLOR[c] }}
              >
                {CATEGORY_LABEL[c]}
              </Badge>
            ))}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="border-t bg-muted/20 p-0">
            <ShiftDetailPanel row={row} onEdit={onEdit} onDelete={onDelete} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Mobile attendance row: date + times on the left, worked hours on the right. */
function AttendanceMobileRow({
  row,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  row: AttendanceRow;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const diffColor =
    row.diffMin == null
      ? "text-muted-foreground"
      : row.diffMin > 0
        ? "text-done"
        : row.diffMin < 0
          ? "text-alert"
          : "text-muted-foreground";
  return (
    <li className="border-t border-border">
      <div className="grid grid-cols-[24px_62px_1fr_auto] items-center gap-2.5 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label="Toggle shift details"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        <div className="text-[10px] font-semibold tabular-nums">{fmtDate(row.date)}</div>
        <div className="min-w-0">
          <div className="text-[10px] tabular-nums text-muted-foreground">
            {fmtTime(row.checkIn)} – {fmtTime(row.checkOut)}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {(row.categories.length ? row.categories : [row.primary]).map((c: HourCategory) => (
              <span
                key={c}
                className="rounded-full px-1.5 py-0.5 text-[7px] font-medium uppercase tracking-wide text-white"
                style={{ backgroundColor: CATEGORY_COLOR[c] }}
              >
                {CATEGORY_LABEL[c]}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] font-semibold tabular-nums">{formatHM(row.workedMin)}</div>
          <div className={`text-[9px] tabular-nums ${diffColor}`}>
            {row.diffMin != null ? formatDiff(row.diffMin) : "—"}
          </div>
        </div>
      </div>
      {expanded && (
        <div className="bg-muted/20">
          <ShiftDetailPanel row={row} onEdit={onEdit} onDelete={onDelete} />
        </div>
      )}
    </li>
  );
}

function AddPastDialog({
  open,
  onClose,
  onSave,
  teachers,
  classDir,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (p: {
    check_in_at: string;
    check_out_at: string;
    classes: ShiftClass[];
    notes: string | null;
  }) => void;
  teachers: DmcOption[];
  classDir: DmcOption[];
}) {
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [classes, setClasses] = useState<ShiftClass[]>([emptyClass()]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setCheckIn("");
      setCheckOut("");
      setClasses([emptyClass()]);
      setNotes("");
    }
  }, [open]);

  function updateClass(i: number, p: Partial<ShiftClass>) {
    setClasses((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...p } : c)));
  }
  function addClass() {
    setClasses((cs) => [...cs, emptyClass()]);
  }
  function removeClass(i: number) {
    setClasses((cs) => cs.filter((_, idx) => idx !== i));
  }

  function submit() {
    const ci = fromLocalInput(checkIn);
    const co = fromLocalInput(checkOut);
    if (!ci) return toast.error("Enter check-in time");
    if (!co) return toast.error("Enter check-out time");
    if (new Date(co).getTime() <= new Date(ci).getTime()) {
      return toast.error("Check-out must be after check-in");
    }
    const cleanedClasses = classes.filter((c) => c.dmcClassId || c.dmcInstructorId);
    onSave({
      check_in_at: ci,
      check_out_at: co,
      classes: cleanedClasses,
      notes: notes.trim() ? notes.trim() : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add past shift</DialogTitle>
          <DialogDescription>Log a shift that already happened.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Check in</Label>
              <Input
                type="datetime-local"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Check out</Label>
              <Input
                type="datetime-local"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Classes</Label>
              <Button type="button" variant="secondary" size="sm" onClick={addClass}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add class
              </Button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Class</span>
                <span>Teacher</span>
                <span className="sr-only">Actions</span>
              </div>
              {classes.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <DmcPicker
                    value={c.dmcClassId}
                    onChange={(o) => updateClass(i, pickDmcClass(o))}
                    options={classDir}
                    placeholder={`Class ${i + 1}`}
                    fallbackLabel={c.class}
                  />
                  <DmcPicker
                    value={c.dmcInstructorId}
                    onChange={(o) => updateClass(i, pickDmcInstructor(o))}
                    options={teachers}
                    placeholder="Teacher"
                    fallbackLabel={c.teacher}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeClass(i)}
                    aria-label="Remove row"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>
            <Save className="mr-1 h-4 w-4" /> Save shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  shift,
  onClose,
  onSave,
  teachers,
  classDir,
}: {
  shift: Shift | null;
  onClose: () => void;
  onSave: (s: Shift) => void;
  teachers: DmcOption[];
  classDir: DmcOption[];
}) {
  const [draft, setDraft] = useState<Shift | null>(shift);

  useEffect(() => {
    setDraft(shift);
  }, [shift?.id]);

  if (!draft) return null;

  function patch(p: Partial<Shift>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }
  function updateClass(i: number, p: Partial<ShiftClass>) {
    setDraft((d) =>
      d ? { ...d, classes: d.classes.map((c, idx) => (idx === i ? { ...c, ...p } : c)) } : d,
    );
  }
  function addClass() {
    setDraft((d) => (d ? { ...d, classes: [...d.classes, emptyClass()] } : d));
  }
  function removeClass(i: number) {
    setDraft((d) => (d ? { ...d, classes: d.classes.filter((_, idx) => idx !== i) } : d));
  }

  return (
    <Dialog open={!!shift} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit shift</DialogTitle>
          <DialogDescription>Update times, classes, and details.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Check in</Label>
              <Input
                type="datetime-local"
                value={toLocalInput(draft.check_in_at)}
                onChange={(e) => {
                  const iso = fromLocalInput(e.target.value);
                  if (iso) patch({ check_in_at: iso });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Check out</Label>
              <Input
                type="datetime-local"
                value={toLocalInput(draft.check_out_at)}
                onChange={(e) => patch({ check_out_at: fromLocalInput(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Shift information</Label>
              <Button type="button" variant="secondary" size="sm" onClick={addClass}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add class
              </Button>
            </div>
            {draft.classes.length === 0 ? (
              <p className="text-xs text-muted-foreground">No classes yet.</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Class</span>
                  <span>Teacher</span>
                  <span className="sr-only">Actions</span>
                </div>
                {draft.classes.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <DmcPicker
                      value={c.dmcClassId}
                      onChange={(o) => updateClass(i, pickDmcClass(o))}
                      options={classDir}
                      placeholder={`Class ${i + 1}`}
                      fallbackLabel={c.class}
                    />
                    <DmcPicker
                      value={c.dmcInstructorId}
                      onChange={(o) => updateClass(i, pickDmcInstructor(o))}
                      options={teachers}
                      placeholder="Teacher"
                      fallbackLabel={c.teacher}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeClass(i)}
                      aria-label="Remove row"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={draft.notes ?? ""}
              onChange={(e) => patch({ notes: e.target.value || null })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => draft && onSave(draft)}>
            <Save className="mr-1 h-4 w-4" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
