import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { adminAddRotationAdjustment, adminListRotationAdjustments, adminRemoveRotationAdjustment } from "@/lib/rotation.functions";
import type { AdjustmentInput, RotationAdjustment } from "@/domain/rotation-adjustments";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const selectStyle = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const blank = (): AdjustmentInput => ({ operator: "", validFrom: "", validUntil: "", bucket: null, weekday: null, startFrom: null, startTo: null, note: null });

export function RotationAdjustments({ operators }: { operators: string[] }) {
  const qc = useQueryClient();
  const list = useServerFn(adminListRotationAdjustments);
  const add = useServerFn(adminAddRotationAdjustment);
  const remove = useServerFn(adminRemoveRotationAdjustment);
  const { data, isPending, error } = useQuery({ queryKey: ["admin-rotation-adjustments"], queryFn: () => list() });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [pending, setPending] = useState<RotationAdjustment | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const refresh = async () => {
    await qc.invalidateQueries({ predicate: ({ queryKey }) => queryKey[0] !== "admin-rotation-adjustments" });
    await qc.invalidateQueries({ queryKey: ["admin-rotation-adjustments"] });
  };
  return <>
    <Card><CardContent className="p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Adjustments</h3><Button size="sm" variant="outline" onClick={() => { setDraft(blank()); setFormError(null); setOpen(true); }}><Plus className="mr-2 h-4 w-4" />Add adjustment</Button></div>
      {isPending && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="mt-4 text-sm text-destructive">Could not load adjustments.</p>}
      {data?.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No adjustments</p>}
      <div className="divide-y divide-border">{data?.map((row) => <div key={row.id} className={`flex items-start justify-between gap-3 py-4 ${Date.parse(row.valid_until) <= Date.now() ? "text-muted-foreground opacity-60" : ""}`}>
        <div className="min-w-0 space-y-1 text-sm">
          <p>{row.weekday !== null ? `${WEEKDAYS[row.weekday]}s` : "All days"}{row.bucket ? ` · ${row.bucket[0].toUpperCase()}${row.bucket.slice(1)} classes` : " · All classes"}{row.start_from || row.start_to ? ` · ${row.start_from?.slice(0, 5) ?? "00:00"}–${row.start_to?.slice(0, 5) ?? "24:00"}` : ""} · <span className="font-medium">{row.operator}</span></p>
          <p className="text-xs text-muted-foreground">{dateLabel(row.valid_from)} → {dateLabel(row.valid_until)}</p>
          {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setPending(row)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Remove</Button>
      </div>)}</div>
    </CardContent></Card>
    <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Add adjustment</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setFormError(null);
        try { await add({ data: draft }); await refresh(); setOpen(false); toast.success("Adjustment saved"); }
        catch (e) { setFormError(e instanceof Error ? e.message : "Could not save adjustment"); }
        finally { setBusy(false); }
      }}>
        <div className="space-y-1.5"><Label htmlFor="adjust-operator">Operator</Label><select required id="adjust-operator" className={selectStyle} value={draft.operator} onChange={(e) => setDraft({ ...draft, operator: e.target.value })}><option value="">Select operator</option>{operators.map((o) => <option key={o}>{o}</option>)}</select></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="adjust-from">From (Berlin)</Label><Input required id="adjust-from" type="datetime-local" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="adjust-until">Until (exclusive, Berlin)</Label><Input required id="adjust-until" type="datetime-local" value={draft.validUntil} onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="adjust-bucket">Bucket</Label><select id="adjust-bucket" className={selectStyle} value={draft.bucket ?? ""} onChange={(e) => setDraft({ ...draft, bucket: e.target.value ? e.target.value as AdjustmentInput["bucket"] : null })}><option value="">All buckets</option><option value="day">Day</option><option value="night">Night</option><option value="weekend">Weekend</option></select></div>
          <div className="space-y-1.5"><Label htmlFor="adjust-weekday">Weekday</Label><select id="adjust-weekday" className={selectStyle} value={draft.weekday ?? ""} onChange={(e) => setDraft({ ...draft, weekday: e.target.value === "" ? null : Number(e.target.value) })}><option value="">All weekdays</option>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>
          <div className="space-y-1.5"><Label htmlFor="adjust-start">Class starts from</Label><Input id="adjust-start" type="time" value={draft.startFrom ?? ""} onChange={(e) => setDraft({ ...draft, startFrom: e.target.value || null })} /></div>
          <div className="space-y-1.5"><Label htmlFor="adjust-end">Class starts before</Label><Input id="adjust-end" type="time" value={draft.startTo ?? ""} onChange={(e) => setDraft({ ...draft, startTo: e.target.value || null })} /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="adjust-note">Note (optional)</Label><Textarea id="adjust-note" maxLength={500} value={draft.note ?? ""} onChange={(e) => setDraft({ ...draft, note: e.target.value || null })} /></div>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save adjustment"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <AlertDialog open={pending !== null} onOpenChange={(v) => { if (!v && !busy) setPending(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove this adjustment?</AlertDialogTitle><AlertDialogDescription>Future unworked shifts will return to the remaining adjustments and normal rotation. Recorded shifts stay unchanged.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button variant="outline" disabled={busy} onClick={() => setPending(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={async () => {
      if (!pending) return;
      setBusy(true);
      try { await remove({ data: { id: pending.id } }); await refresh(); setPending(null); toast.success("Adjustment removed"); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Could not remove adjustment"); }
      finally { setBusy(false); }
    }}>{busy ? "Removing…" : "Remove"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}