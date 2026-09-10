import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DmcPicker } from "@/components/DmcPicker";
import { listDmcDirectory, type DmcOption } from "@/lib/dmc-directory.functions";
import {
  listMyShiftClasses,
  addMyShiftClass,
  updateMyShiftClass,
  removeMyShiftClass,
  type CalendarClassRow,
} from "@/lib/gcal.functions";
import type { ScheduledShiftRow } from "@/lib/shifts.functions";
import { addDayKey, crossesMidnight, fmtClock, fmtDayShort, validateInterval } from "@/lib/class-interval";
import { Monitor, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteMyScheduledShift } from "@/lib/shifts.functions";
import { Link } from "@tanstack/react-router";
import { temporaryClassSearch } from "@/lib/studio-presets";
import { toast } from "sonner";

type Draft = {
  id: string;
  /** Canonical DMC references — the only class/teacher identity a row can have. */
  dmcClassId: string | null;
  dmcInstructorId: string | null;
  /** Historical text of rows recorded before the DMC references existed. */
  legacyClassName: string;
  legacyTeacherName: string;
  startTime: string;
  endTime: string;
  overnight: boolean;
  isNew: boolean;
  removed: boolean;
  original?: CalendarClassRow;
};

const hhmm = (t: string) => t.slice(0, 5);

function toDraft(c: CalendarClassRow): Draft {
  return {
    id: c.id,
    dmcClassId: c.dmc_class_id,
    dmcInstructorId: c.dmc_instructor_id,
    legacyClassName: c.class_name,
    legacyTeacherName: c.teacher_name === "—" ? "" : c.teacher_name,
    startTime: hhmm(c.start_time),
    endTime: hhmm(c.end_time),
    overnight: crossesMidnight(c.start_time, c.end_time),
    isNew: false,
    removed: false,
    original: c,
  };
}

/**
 * Operator shift inspection first, editing second. Read-only overview of the
 * shift's classes (the same rows the dashboard shows) with an Edit action for
 * the class/teacher information the operator is allowed to change.
 */
export function ShiftOverviewDialog({
  shift,
  onClose,
  onChanged,
}: {
  shift: ScheduledShiftRow | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const fetchClasses = useServerFn(listMyShiftClasses);
  const addClass = useServerFn(addMyShiftClass);
  const updateClass = useServerFn(updateMyShiftClass);
  const removeClass = useServerFn(removeMyShiftClass);
  const deleteShiftFn = useServerFn(deleteMyScheduledShift);
  const fetchDmcDirectory = useServerFn(listDmcDirectory);

  const [classes, setClasses] = useState<CalendarClassRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [teacherOptions, setTeacherOptions] = useState<DmcOption[]>([]);
  const [classOptions, setClassOptions] = useState<DmcOption[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const shiftId = shift?.id ?? null;

  useEffect(() => {
    if (!shiftId) return;
    setEditing(false);
    setConfirmDelete(false);
    setLoading(true);
    fetchClasses({ data: { shiftId } })
      .then((rows) => setClasses(rows))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load classes"))
      .finally(() => setLoading(false));
  }, [shiftId, fetchClasses]);

  useEffect(() => {
    if (!shiftId) return;
    fetchDmcDirectory()
      .then((d) => {
        setClassOptions(d.classes);
        setTeacherOptions(d.instructors);
      })
      .catch(() => {
        /* pickers stay empty; saving requires a DMC class anyway */
      });
  }, [shiftId, fetchDmcDirectory]);

  const startDate = shift?.specific_date ?? "";
  const overnightShift = shift ? crossesMidnight(shift.start_time, shift.end_time) : false;
  const endDate = overnightShift ? addDayKey(startDate, 1) : startDate;

  const dayLabel = useMemo(() => {
    if (!startDate) return "";
    const [y, m, d] = startDate.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [startDate]);

  function beginEdit() {
    setDrafts(classes.map(toDraft));
    setEditing(true);
  }

  function patchDraft(id: string, patch: Partial<Draft>) {
    setDrafts((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addDraft() {
    setDrafts((rows) => [
      ...rows,
      {
        id: `new-${Date.now()}-${rows.length}`,
        dmcClassId: null,
        dmcInstructorId: null,
        legacyClassName: "",
        legacyTeacherName: "",
        startTime: hhmm(shift?.start_time ?? "18:00"),
        endTime: hhmm(shift?.end_time ?? "19:00"),
        overnight: false,
        isNew: true,
        removed: false,
      },
    ]);
  }

  const labelOf = (d: Draft) =>
    classOptions.find((o) => o.id === d.dmcClassId)?.name || d.legacyClassName || "New class";

  async function save() {
    if (!shift) return;
    const active = drafts.filter((d) => !d.removed);
    for (const d of active) {
      // A class row must point at a real DMC class; free text is not an option.
      if (!d.dmcClassId) return toast.error("Select a DMC class for every row");
      const err = validateInterval(d.startTime, d.endTime, d.overnight);
      if (err) return toast.error(`${labelOf(d)}: ${err}`);
    }
    setSaving(true);
    try {
      for (const d of drafts) {
        const classDate = startDate;
        if (d.removed) {
          if (!d.isNew) await removeClass({ data: { id: d.id } });
          continue;
        }
        if (d.isNew) {
          await addClass({
            data: {
              shiftId: shift.id,
              dmcClassId: d.dmcClassId!,
              dmcInstructorId: d.dmcInstructorId,
              specificDate: classDate,
              startTime: d.startTime,
              endTime: d.endTime,
            },
          });
          continue;
        }
        const o = d.original!;
        const changed =
          d.dmcClassId !== o.dmc_class_id ||
          d.dmcInstructorId !== o.dmc_instructor_id ||
          d.startTime !== hhmm(o.start_time) ||
          d.endTime !== hhmm(o.end_time);
        if (changed) {
          await updateClass({
            data: {
              id: d.id,
              dmcClassId: d.dmcClassId!,
              dmcInstructorId: d.dmcInstructorId,
              startTime: d.startTime,
              endTime: d.endTime,
            },
          });
        }
      }
      const rows = await fetchClasses({ data: { shiftId: shift.id } });
      setClasses(rows);
      setEditing(false);
      toast.success("Shift updated");
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // A shift can only be removed before it starts; in-progress, completed and
  // past shifts stay untouched (attendance history is permanent).
  const startAt = useMemo(() => {
    if (!shift?.specific_date) return null;
    const [y, m, d] = shift.specific_date.split("-").map(Number);
    const [hh, mm] = shift.start_time.split(":").map(Number);
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  }, [shift?.specific_date, shift?.start_time]);
  const deletable =
    !!startAt &&
    startAt.getTime() > Date.now() &&
    (shift?.status ?? "").toLowerCase() !== "completed";

  async function confirmDeleteShift() {
    if (!shift) return;
    setDeleting(true);
    try {
      await deleteShiftFn({ data: { id: shift.id } });
      setConfirmDelete(false);
      toast.success("Shift deleted.");
      onClose();
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete this shift");
    } finally {
      setDeleting(false);
    }
  }

  if (!shift) return null;

  const classCount = classes.filter((c) => c.status !== "cancelled").length;

  return (
    <Dialog open={!!shift} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit shift" : "Shift details"}</DialogTitle>
          <DialogDescription>{dayLabel}</DialogDescription>
        </DialogHeader>

        {!editing ? (
          <div className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Shift Start
              </div>
              <div className="text-sm font-medium tabular-nums">
                {overnightShift ? `${fmtDayShort(startDate)} · ` : ""}
                {fmtClock(shift.start_time)}
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading classes…</p>
            ) : classes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No classes are linked to this shift yet.
              </p>
            ) : (
              <div className="space-y-3">
                {classes.map((c) => {
                  const overnightClass = crossesMidnight(c.start_time, c.end_time);
                  return (
                    <div key={c.id} className="rounded-lg border border-border/60 p-3">
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {overnightClass ? `${fmtDayShort(c.specific_date)} · ` : ""}
                        {fmtClock(c.start_time)} –{" "}
                        {overnightClass ? `${fmtDayShort(addDayKey(c.specific_date, 1))} · ` : ""}
                        {fmtClock(c.end_time)}
                      </div>
                      <div className="text-sm font-medium">{c.class_name}</div>
                      <div className="text-sm text-muted-foreground">{c.teacher_name}</div>
                      {c.status === "cancelled" ? (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          Cancelled
                        </Badge>
                      ) : (
                        <Link
                          to="/studio-display"
                          search={temporaryClassSearch({
                            classId: c.id,
                            className: c.class_name,
                            teacherName: c.teacher_name === "—" ? "" : c.teacher_name,
                            date: c.specific_date,
                            startTime: hhmm(c.start_time),
                            endTime: hhmm(c.end_time),
                          })}
                          onClick={onClose}
                          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline max-lg:hidden"
                        >
                          <Monitor className="h-3.5 w-3.5" />
                          Go to Studio Display
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Shift End</div>
              <div className="text-sm font-medium tabular-nums">
                {overnightShift ? `${fmtDayShort(endDate)} · ` : ""}
                {fmtClock(shift.end_time)}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              {classCount === 1 ? "1 class" : `${classCount} classes`}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {drafts.filter((d) => !d.removed).length === 0 && (
              <p className="text-sm text-muted-foreground">No classes. Add one below.</p>
            )}
            {drafts.map((d) =>
              d.removed ? null : (
                <div key={d.id} className="space-y-2 rounded-lg border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {d.isNew ? "New class" : "Class"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      aria-label="Remove class from shift"
                      onClick={() => patchDraft(d.id, { removed: true })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Class name</Label>
                    <DirectoryCombobox
                      value={d.className}
                      onChange={(name) => patchDraft(d.id, { className: name })}
                      options={classOptions}
                      placeholder="Select or type a class"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Teacher</Label>
                    <DirectoryCombobox
                      value={d.teacherName}
                      onChange={(name) => patchDraft(d.id, { teacherName: name })}
                      options={teacherOptions}
                      placeholder="Select or type teacher"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Start</Label>
                      <Input
                        type="time"
                        value={d.startTime}
                        onChange={(e) => patchDraft(d.id, { startTime: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">End</Label>
                      <Input
                        type="time"
                        value={d.endTime}
                        onChange={(e) =>
                          patchDraft(d.id, {
                            endTime: e.target.value,
                            overnight: crossesMidnight(d.startTime, e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={d.overnight}
                      onChange={(e) => patchDraft(d.id, { overnight: e.target.checked })}
                    />
                    Ends next day ({fmtDayShort(addDayKey(startDate, 1))})
                  </label>
                </div>
              ),
            )}

            <Button variant="outline" size="sm" onClick={addDraft}>
              <Plus className="mr-1 h-4 w-4" /> Add class
            </Button>
          </div>
        )}

        <DialogFooter className="flex-row justify-end gap-2 sm:justify-end">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <>
              {deletable && (
                <Button
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleting}
                  className="mr-auto"
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Delete Shift
                </Button>
              )}
              <Button variant="outline" onClick={onClose}>
                <X className="mr-1 h-4 w-4" /> Close
              </Button>
              <Button onClick={beginEdit} disabled={loading}>
                <Pencil className="mr-1 h-4 w-4" /> Edit
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              {dayLabel} · {fmtClock(shift.start_time)} –{" "}
              {overnightShift ? `${fmtDayShort(endDate)} · ` : ""}
              {fmtClock(shift.end_time)}
              {classCount
                ? ` · ${classCount} ${classCount === 1 ? "class" : "classes"}`
                : shift.label
                  ? ` · ${shift.label}`
                  : ""}
              . This removes the shift from the app and it will no longer appear in your
              schedule. It will not come back on the next calendar sync.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteShift}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete Shift"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
