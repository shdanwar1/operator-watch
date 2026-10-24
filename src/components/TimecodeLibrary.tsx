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
      const { rows: saved, hiddenIds } = await list();
      const hidden = new Set(hiddenIds);
      const result: LibraryRow[] = saved;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith("timecode:")) continue;
          const classId = key.slice(9);
          if (hidden.has(classId) || result.some(r => r.classId === classId)) continue;
          const state = JSON.parse(localStorage.getItem(key) ?? "null") as TimecodeState | null;
          if (!state || !Array.isArray(state.markers)) continue;
          result.push({ classId, className: "Ballet draft", teacherName: null, date: null, start: null, end: null, updatedAt: "", state, localOnly: true });
        }
      } catch { /* Saved sessions remain usable if device storage is unavailable. */ }
      setRows(result);
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
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <h1 className="text-xl font-semibold">Timecodes</h1>
      {error ? <div className="space-y-3 py-8 text-center"><p className="text-sm text-muted-foreground">Could not load timecodes.</p><Button variant="outline" onClick={() => void load()}>Try again</Button></div> : rows == null ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No saved timecodes yet.</p> :
      Object.entries(rows.reduce<Record<string, LibraryRow[]>>((g, r) => { const k = r.localOnly ? "On this device" : timecodeDateLabel(r.date); (g[k] ??= []).push(r); return g; }, {})).map(([label, group]) => <section key={label} className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-live">{label}</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{group.map(r => {
          const name = timecodeFilename({ date: r.date, start: r.start, teacher: r.teacherName, className: r.className });
          return <li key={r.classId} className="flex items-center gap-4 px-4 py-3 sm:px-6">
            {r.start && <span className="tc-num hidden w-24 shrink-0 text-sm sm:block">{r.start}<span className="text-muted-foreground">–{r.end}</span></span>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.className ?? "Ballet class"}</p>
              <p className="truncate text-xs text-muted-foreground">{r.start && <span className="tc-num sm:hidden">{r.start}–{r.end} · </span>}{r.teacherName ?? ""}</p>
            </div>
            <Button size="sm" variant="ghost" asChild><Link to="/timecode" search={{ cid: r.classId, cn: r.className ?? undefined, tn: r.teacherName ?? undefined, cd: r.date ?? undefined, cs: r.start ?? undefined, ce: r.end ?? undefined }}>Open</Link></Button>
            <Button size="sm" variant="outline" disabled={!r.state.markers.length} onClick={() => downloadEdl(name, r.state.markers)}><Download className="mr-1.5 h-4 w-4" /> EDL</Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Delete ${r.className ?? "Ballet class"} timecode`} title="Delete timecode" onClick={() => setPending(r)}><Trash2 className="h-4 w-4" /></Button>
          </li>;
        })}</ul>
      </section>)}
    </div>
    <AlertDialog open={pending != null} onOpenChange={open => { if (!open && !deleting) setPending(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this timecode?</AlertDialogTitle><AlertDialogDescription>{pending?.className ?? "Ballet class"} and its markers will be removed{pending?.localOnly ? " from this device" : " for all operators, along with this device’s draft"}. The class and shift records stay unchanged. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button variant="outline" disabled={deleting} onClick={() => setPending(null)}>Cancel</Button><Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}><Trash2 className="mr-2 h-4 w-4" />{deleting ? "Deleting…" : "Delete timecode"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </AppShell>;
}