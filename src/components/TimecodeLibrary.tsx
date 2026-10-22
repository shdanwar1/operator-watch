import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Timer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { MARKER_DOT } from "./TimecodeTimeline";
import { deleteClassTimecode, listPastTimecodes, type PastTimecode } from "@/lib/timecode.functions";
import { MARKER_KINDS, timecodeDateLabel, timecodeFilename, type TimecodeState } from "@/lib/timecode";
import { cn } from "@/lib/utils";

type LibraryRow = PastTimecode & { localOnly?: boolean };

export function TimecodeLibrary({ downloadEdl }: { downloadEdl: (name: string, markers: TimecodeState["markers"]) => void }) {
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<LibraryRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const remove = useServerFn(deleteClassTimecode);
  const list = useServerFn(listPastTimecodes);
  async function load() {
    setError(false);
    try {
      const saved: LibraryRow[] = await list();
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith("timecode:")) continue;
          const classId = key.slice(9);
          if (saved.some(r => r.classId === classId)) continue;
          const state = JSON.parse(localStorage.getItem(key) ?? "null") as TimecodeState | null;
          if (!Array.isArray(state?.markers)) continue;
          saved.push({ classId, className: "Ballet draft", teacherName: null, date: null, start: null, end: null, updatedAt: "", state, localOnly: true });
        }
      } catch { /* Saved sessions remain usable if device storage is unavailable. */ }
      setRows(saved);
    } catch { setError(true); }
  }
  useEffect(() => { void load(); }, []);
  async function confirmDelete() {
    if (!pending) return;
    setDeleting(true);
    try {
      if (!pending.localOnly) await remove({ data: { classId: pending.classId } });
      try { localStorage.removeItem(`timecode:${pending.classId}`); } catch {
        if (pending.localOnly) throw new Error("Could not clear draft");
        toast.error("Saved timecode deleted, but this device's draft could not be cleared");
      }
      setRows(current => current?.filter(r => r.classId !== pending.classId) ?? []);
      setPending(null);
      toast.success("Timecode deleted");
    } catch { toast.error("Could not delete timecode. Try again."); }
    finally { setDeleting(false); }
  }
  return <AppShell>
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-8">
      <header className="flex items-baseline justify-between"><h1 className="text-lg font-semibold">Timecodes</h1><span className="text-xs text-muted-foreground">{rows ? `${rows.length} sessions` : ""}</span></header>
      {error ? <div className="space-y-3 py-8 text-center"><p className="text-sm text-muted-foreground">Could not load timecodes.</p><Button variant="outline" onClick={() => void load()}>Try again</Button></div> : rows == null ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No saved timecodes yet.</p> :
      <ul className="space-y-3">{rows.map(r => {
        const name = timecodeFilename({ date: r.date, start: r.start, teacher: r.teacherName, className: r.className });
        const breakdown = [...MARKER_KINDS.map(k => k.kind), "Highlight" as const].map(kind => ({ kind, count: r.state.markers.filter(m => m.kind === kind).length })).filter(k => k.count > 0);
        return <li key={r.classId} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-3"><Timer className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-xs font-medium text-live">{timecodeDateLabel(r.date)}</span>{r.start && <span className="tc-num text-xs text-muted-foreground">{r.start}–{r.end}</span>}{r.localOnly && <span className="text-xs text-muted-foreground">On this device</span>}</div>
            <h2 className="mt-1 break-words text-base font-semibold">{r.className ?? "Ballet class"}</h2>
            {r.teacherName && <span className="mt-2 inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{r.teacherName}</span>}
          </div><Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Delete ${r.className ?? "Ballet class"} timecode`} title="Delete timecode" onClick={() => setPending(r)}><Trash2 className="h-4 w-4" /></Button></div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>{r.state.markers.length} markers</span>{breakdown.map(k => <span key={k.kind} className="inline-flex items-center gap-1.5" title={k.kind}><span className={cn("h-2 w-2 rounded-full", MARKER_DOT[k.kind])} />{k.kind} {k.count}</span>)}</div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><p className="tc-num min-w-0 flex-1 break-all text-[11px] text-muted-foreground">{name}.edl</p><div className="flex shrink-0 gap-2"><Button size="sm" variant="ghost" asChild><Link to="/timecode" search={{ cid: r.classId, cn: r.className ?? undefined, tn: r.teacherName ?? undefined, cd: r.date ?? undefined, cs: r.start ?? undefined, ce: r.end ?? undefined }}>Open</Link></Button><Button size="sm" variant="outline" disabled={!r.state.markers.length} onClick={() => downloadEdl(name, r.state.markers)}><Download className="mr-1.5 h-4 w-4" /> EDL</Button></div></div>
        </li>;
      })}</ul>}
    </div>
    <AlertDialog open={pending != null} onOpenChange={open => { if (!open && !deleting) setPending(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this timecode?</AlertDialogTitle><AlertDialogDescription>{pending?.className ?? "Ballet class"} and its markers will be removed{pending?.localOnly ? " from this device" : " for all operators, along with this device’s draft"}. The class and shift records stay unchanged. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button variant="outline" disabled={deleting} onClick={() => setPending(null)}>Cancel</Button><Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}><Trash2 className="mr-2 h-4 w-4" />{deleting ? "Deleting…" : "Delete timecode"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </AppShell>;
}