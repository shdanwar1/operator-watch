import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowUpRight } from "lucide-react";
import { notesEditable } from "@/lib/studio-display";
import type { StudioConfig } from "@/lib/studio-presets";

export type StudioConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Subtitle line, e.g. the class + teacher for a temporary class. */
  description?: string;
  initial: StudioConfig;
  onOpenDisplay: (config: StudioConfig) => void;
};

export function StudioConfigDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  onOpenDisplay,
}: StudioConfigDialogProps) {
  const [startTime, setStartTime] = useState(initial.startTime);
  const [notes, setNotes] = useState(initial.notes);
  const [, force] = useState(0);
  const durationMin = initial.durationMin;

  useEffect(() => {
    if (!open) return;
    setStartTime(initial.startTime);
    setNotes(initial.notes);
  }, [open, initial.startTime, initial.notes]);

  // Keeps the notes lock in sync with the class interval while the popup is up.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [open]);

  const config: StudioConfig = { ...initial, startTime, durationMin, notes };
  const canEditNotes = notesEditable(
    { startTime, durationMin, timerMode: "next" },
    new Date(),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? `${durationMin} minute class`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sd-start" className="text-xs">
              Class start time
            </Label>
            <Input
              id="sd-start"
              type="time"
              className="h-10"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sd-notes" className="text-xs">
              Notes for display
            </Label>
            <textarea
              id="sd-notes"
              rows={3}
              value={notes}
              disabled={!canEditNotes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={canEditNotes ? "Welcome everyone…" : "Available during class"}
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            {!canEditNotes && (
              <p className="text-[11px] text-muted-foreground">
                Notes can be edited while the class is running.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button className="w-full rounded-full" onClick={() => onOpenDisplay(config)}>
            Open Studio Display
            <ArrowUpRight className="ml-1.5 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
