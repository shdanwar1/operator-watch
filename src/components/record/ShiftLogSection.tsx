// Worked-shift log. Extracted from the former /shifts page so the Record
// screen can show attendance totals and the shift log in one place.
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  listShifts,
  updateShift as updateShiftFn,
  deleteShift as deleteShiftFn,
  createPastShift as createPastShiftFn,
} from "@/lib/shifts.functions";
import {
  listTeachers,
  listClasses,
  recordDirectoryUsage,
  type DirectoryItem,
} from "@/lib/directories.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ChevronDown, Pencil, Plus, Trash2, X, Save } from "lucide-react";
import { operatorNamespace, readCache, writeCache } from "@/lib/local-cache";
export type ShiftClass = { class: string; teacher: string };
import { DirectoryCombobox } from "@/components/DirectoryCombobox";


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
function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { timeStyle: "short" });
}
function duration(a: string, b: string | null) {
  const end = b ? new Date(b).getTime() : Date.now();
  const mins = Math.max(0, Math.floor((end - new Date(a).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return `${h}h ${(mins % 60).toString().padStart(2, "0")}m`;
}

export function ShiftLogSection({ username }: { username: string | null }) {

  type ShiftsSnapshot = { shifts: Shift[]; teachers: DirectoryItem[]; classDir: DirectoryItem[] };
  const shiftsCacheKey = username ? `${operatorNamespace(username)}shifts` : null;
  const [cachedShifts] = useState<ShiftsSnapshot | null>(() =>
    shiftsCacheKey ? readCache<ShiftsSnapshot>(shiftsCacheKey) : null,
  );

  const [shifts, setShifts] = useState<Shift[]>(cachedShifts?.shifts ?? []);
  const [teachers, setTeachers] = useState<DirectoryItem[]>(cachedShifts?.teachers ?? []);
  const [classDir, setClassDir] = useState<DirectoryItem[]>(cachedShifts?.classDir ?? []);
  const [loading, setLoading] = useState(!cachedShifts);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addingPast, setAddingPast] = useState(false);
  const fetchShifts = useServerFn(listShifts);
  const fetchTeachers = useServerFn(listTeachers);
  const fetchClasses = useServerFn(listClasses);
  const recordUsage = useServerFn(recordDirectoryUsage);
  const updateShiftServer = useServerFn(updateShiftFn);
  const deleteShiftServer = useServerFn(deleteShiftFn);
  const createPastServer = useServerFn(createPastShiftFn);

  useEffect(() => {
    load();
  }, []);

  const hasLoadedOnce = useRef(!!cachedShifts);
  async function load() {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const [rows, tRows, cRows] = await Promise.all([
        fetchShifts(),
        fetchTeachers(),
        fetchClasses(),
      ]);
      setShifts(rows as Shift[]);
      setTeachers(tRows);
      setClassDir(cRows);
      if (shiftsCacheKey) {
        writeCache<ShiftsSnapshot>(shiftsCacheKey, {
          shifts: rows as Shift[],
          teachers: tRows,
          classDir: cRows,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true;
    }
  }

  async function recordShiftUsage(cs: ShiftClass[]) {
    try {
      await recordUsage({
        data: {
          teachers: cs.map((c) => c.teacher).filter(Boolean),
          classes: cs.map((c) => c.class).filter(Boolean),
        },
      });
    } catch { /* non-fatal */ }
  }

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
      await recordShiftUsage(next.classes);
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
      await recordShiftUsage(payload.classes);
      toast.success("Past shift added");
      setAddingPast(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium tracking-tight">Shift log</h2>
        <Button size="sm" variant="outline" onClick={() => setAddingPast(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add past shift
        </Button>
      </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shifts yet.</p>
        ) : (
          <div className="space-y-3">
            {shifts.map((s) => (
              <Card key={s.id} className="max-lg:glass max-lg:rounded-[22px]">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.operator_name}</span>
                      {!s.check_out_at && (
                        <Badge variant="destructive" className="text-[10px]">ACTIVE</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground max-md:text-[12px]">
                      <span className="tabular-nums">{fmt(s.check_in_at)}</span> →{" "}
                      <span className="tabular-nums">{fmt(s.check_out_at)}</span> •{" "}
                      <span className="tabular-nums">{duration(s.check_in_at, s.check_out_at)}</span> •{" "}
                      <span className="text-foreground tabular-nums">{s.classes.length}</span> streams
                    </div>
                    {s.classes.length > 0 && (
                      <>
                        {/* Mobile: a plain divided list instead of a cramped table. */}
                        <ul className="mt-3 border-t border-border md:hidden">
                          {s.classes.map((c, i) => (
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

                        <div className="mt-3 hidden overflow-hidden rounded-md border md:block">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                              <tr>
                                <th className="px-3 py-1.5 text-left font-medium">Class</th>
                                <th className="px-3 py-1.5 text-left font-medium">Teacher</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.classes.map((c, i) => (
                                <tr key={i} className="border-t">
                                  <td className="px-3 py-1.5">{c.class || <span className="text-muted-foreground">—</span>}</td>
                                  <td className="px-3 py-1.5">{c.teacher || <span className="text-muted-foreground">—</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {s.notes && (
                      <p className="mt-2 text-sm italic text-muted-foreground">"{s.notes}"</p>
                    )}
                  </div>
                  <div className="flex gap-1 max-md:mt-1 max-md:justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(s)}
                      aria-label="Edit shift"
                      className="max-md:h-9 max-md:w-9 max-md:p-0"
                    >
                      <Pencil className="h-3.5 w-3.5 md:mr-1" />
                      <span className="max-md:hidden">Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteShift(s.id)}
                      aria-label="Delete shift"
                      className="max-md:h-9 max-md:w-9"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>

              </Card>
            ))}
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
  teachers: DirectoryItem[];
  classDir: DirectoryItem[];
}) {
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [classes, setClasses] = useState<ShiftClass[]>([{ class: "", teacher: "" }]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setCheckIn("");
      setCheckOut("");
      setClasses([{ class: "", teacher: "" }]);
      setNotes("");
    }
  }, [open]);

  function updateClass(i: number, p: Partial<ShiftClass>) {
    setClasses((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...p } : c)));
  }
  function addClass() {
    setClasses((cs) => [...cs, { class: "", teacher: "" }]);
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
    const cleanedClasses = classes
      .map((c) => ({ class: c.class.trim(), teacher: c.teacher.trim() }))
      .filter((c) => c.class || c.teacher);
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
                  <DirectoryCombobox
                    value={c.class}
                    onChange={(v) => updateClass(i, { class: v })}
                    options={classDir}
                    placeholder={`Class ${i + 1}`}
                  />
                  <DirectoryCombobox
                    value={c.teacher}
                    onChange={(v) => updateClass(i, { teacher: v })}
                    options={teachers}
                    placeholder="Teacher"
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
          <Button variant="outline" onClick={onClose}>Cancel</Button>
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
  teachers: DirectoryItem[];
  classDir: DirectoryItem[];
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
    setDraft((d) => (d ? { ...d, classes: d.classes.map((c, idx) => (idx === i ? { ...c, ...p } : c)) } : d));
  }
  function addClass() {
    setDraft((d) => (d ? { ...d, classes: [...d.classes, { class: "", teacher: "" }] } : d));
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
                    <DirectoryCombobox
                      value={c.class}
                      onChange={(v) => updateClass(i, { class: v })}
                      options={classDir}
                      placeholder={`Class ${i + 1}`}
                    />
                    <DirectoryCombobox
                      value={c.teacher}
                      onChange={(v) => updateClass(i, { teacher: v })}
                      options={teachers}
                      placeholder="Teacher"
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
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => draft && onSave(draft)}>
            <Save className="mr-1 h-4 w-4" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
