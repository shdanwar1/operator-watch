import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminListShiftsForSession, adminListOperators } from "@/lib/operators.functions";
import {
  updateShift,
  deleteShift,
  listScheduledShifts,
  type ShiftRow,
} from "@/lib/shifts.functions";
import { summarizeMonth } from "@/lib/attendance";
import { downloadAttendancePdf } from "@/lib/attendance-pdf";
import { fmtHours, opColor } from "@/lib/admin-utils";

export const Route = createFileRoute("/admin/shifts")({
  head: () => ({
    meta: [
      { title: "Worked Shifts — Dance Masterclass Admin" },
      {
        name: "description",
        content: "Management table of every operator's worked shifts with classes, hours and notes.",
      },
      { property: "og:title", content: "Worked Shifts — Dance Masterclass Admin" },
      {
        property: "og:description",
        content: "Management table of every operator's worked shifts.",
      },
    ],
  }),
  component: AdminShifts,
});

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function AdminShifts() {
  const qc = useQueryClient();
  const fetchShifts = useServerFn(adminListShiftsForSession);
  const fetchOps = useServerFn(adminListOperators);
  const updateFn = useServerFn(updateShift);
  const deleteFn = useServerFn(deleteShift);

  const [opFilter, setOpFilter] = useState("all");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [editing, setEditing] = useState<ShiftRow | null>(null);

  const { data: shifts, isPending } = useQuery({
    queryKey: ["admin", "worked-shifts"],
    queryFn: () => fetchShifts(),
  });
  const { data: operators } = useQuery({
    queryKey: ["admin", "operators"],
    queryFn: () => fetchOps(),
  });

  const months = useMemo(() => {
    const set = new Set<string>((shifts ?? []).map((s) => monthKey(s.check_in_at)));
    set.add(new Date().toISOString().slice(0, 7));
    return Array.from(set).sort().reverse();
  }, [shifts]);

  const rows = useMemo(() => {
    return (shifts ?? [])
      .filter((s) => (opFilter === "all" ? true : s.operator_name === opFilter))
      .filter((s) => (month === "all" ? true : monthKey(s.check_in_at) === month))
      .sort((a, b) => b.check_in_at.localeCompare(a.check_in_at));
  }, [shifts, opFilter, month]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "worked-shifts"] });

  // Attendance export always uses the selected operator and the CURRENT month.
  const fetchScheduled = useServerFn(listScheduledShifts);
  const { data: scheduled } = useQuery({
    queryKey: ["admin", "scheduled-shifts"],
    queryFn: () => fetchScheduled(),
  });
  // Attendance export always uses the operator and month selected above.
  const exportMonthStart = useMemo(() => {
    const n = new Date();
    if (month === "all") return new Date(n.getFullYear(), n.getMonth(), 1);
    const [y, m] = month.split("-").map((v) => parseInt(v, 10));
    return new Date(y, m - 1, 1);
  }, [month]);
  const exportMonthLabel = exportMonthStart.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const operatorSelected = opFilter !== "all";

  const downloadAttendance = () => {
    if (!operatorSelected) return;
    const opShifts = (shifts ?? []).filter((s) => s.operator_name === opFilter);
    const opScheduled = (scheduled ?? []).filter(
      (s) => (s.assigned_operator ?? "").toLowerCase() === opFilter.toLowerCase(),
    );
    const summary = summarizeMonth(opShifts, opScheduled, exportMonthStart);
    if (summary.rows.length === 0) {
      toast.error(`No completed shifts for ${opFilter} in ${exportMonthLabel}`);
      return;
    }
    downloadAttendancePdf(summary, opFilter);
  };


  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Worked shifts for every operator.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={opFilter} onValueChange={setOpFilter}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All operators</SelectItem>
              {(operators ?? []).map((o) => (
                <SelectItem key={o.id} value={o.username}>
                  {o.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {months.map((m) => (
                <SelectItem key={m} value={m}>
                  {new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            disabled={!operatorSelected}
            title={
              operatorSelected
                ? `${opFilter} · ${exportMonthLabel}`
                : "Select an operator to export attendance"
            }
            onClick={downloadAttendance}
          >
            <Download className="mr-1.5 h-4 w-4" />
            {operatorSelected ? "Download Attendance" : "Select an operator"}
          </Button>
        </div>
      </header>
      {operatorSelected && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Attendance PDF: {opFilter} · {exportMonthLabel}
        </p>
      )}


      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Operator</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Shift</th>
                  <th className="px-4 py-3 font-medium">Classes</th>
                  <th className="px-4 py-3 font-medium">Teachers</th>
                  <th className="px-4 py-3 font-medium">Worked</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {isPending && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!isPending && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      No shifts for this selection.
                    </td>
                  </tr>
                )}
                {rows.map((s) => {
                  const inAt = new Date(s.check_in_at);
                  const outAt = s.check_out_at ? new Date(s.check_out_at) : null;
                  const mins = outAt
                    ? Math.max(0, Math.round((outAt.getTime() - inAt.getTime()) / 60000))
                    : 0;
                  const teachers = new Set(s.classes.map((c) => c.teacher).filter(Boolean));
                  const c = opColor(s.operator_name);
                  return (
                    <tr key={s.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${c?.dot}`} />
                          {s.operator_name}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                        {inAt.toLocaleDateString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                        {inAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                        {outAt
                          ? outAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : "…"}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{s.classes.length}</td>
                      <td className="px-4 py-3 tabular-nums">{teachers.size}</td>
                      <td className="px-4 py-3 tabular-nums">{outAt ? fmtHours(mins) : "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={outAt ? "secondary" : "default"} className="text-[10px]">
                          {outAt ? "Completed" : "Active"}
                        </Badge>
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">
                        {s.notes ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <EditWorkedShiftDialog
        shift={editing}
        operators={(operators ?? []).map((o) => o.username)}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          if (!editing) return;
          await updateFn({ data: { id: editing.id, patch } });
          setEditing(null);
          refresh();
          toast.success("Shift updated");
        }}
        onDelete={async () => {
          if (!editing) return;
          await deleteFn({ data: { id: editing.id } });
          setEditing(null);
          refresh();
          toast.success("Shift deleted");
        }}
      />
    </div>
  );
}

function EditWorkedShiftDialog({
  shift,
  operators,
  onClose,
  onSave,
  onDelete,
}: {
  shift: ShiftRow | null;
  operators: string[];
  onClose: () => void;
  onSave: (patch: {
    operator_name?: string;
    check_in_at?: string;
    check_out_at?: string | null;
    notes?: string | null;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [op, setOp] = useState("");
  const [inAt, setInAt] = useState("");
  const [outAt, setOutAt] = useState("");
  const [notes, setNotes] = useState("");

  const toLocalInput = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Reset the form whenever a different shift is opened.
  const key = shift?.id ?? "";
  useMemo(() => {
    if (shift) {
      setOp(shift.operator_name);
      setInAt(toLocalInput(shift.check_in_at));
      setOutAt(toLocalInput(shift.check_out_at));
      setNotes(shift.notes ?? "");
    }
    return key;
  }, [key]);

  if (!shift) return null;

  return (
    <Dialog open={!!shift} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit shift</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Operator</Label>
            <Select value={op} onValueChange={setOp}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set([op, ...operators]))
                  .filter(Boolean)
                  .map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Reassigning moves this shift's hours and pay to another operator.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Check in</Label>
              <Input
                type="datetime-local"
                value={inAt}
                onChange={(e) => setInAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Check out</Label>
              <Input
                type="datetime-local"
                value={outAt}
                onChange={(e) => setOutAt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
            {shift.classes.length === 0
              ? "No classes logged."
              : shift.classes.map((c, i) => (
                  <div key={i}>
                    {c.class} · {c.teacher}
                  </div>
                ))}
          </div>
        </div>
        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button variant="destructive" size="sm" onClick={onDelete}>
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() =>
                onSave({
                  operator_name: op,
                  check_in_at: inAt ? new Date(inAt).toISOString() : undefined,
                  check_out_at: outAt ? new Date(outAt).toISOString() : null,
                  notes: notes || null,
                })
              }
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
