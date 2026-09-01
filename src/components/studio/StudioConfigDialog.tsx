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
import { MIN_DURATION_MIN, notesEditable } from "@/lib/studio-display";
import type { StudioConfig } from "@/lib/studio-presets";

export type StudioConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Subtitle line, e.g. the class + teacher for a temporary class. */
  description?: string;
  /** Workout/Ballet lock the duration; Customize lets the operator edit it. */
  editableDuration: boolean;
  /** Only Customize offers saving the configuration as a reusable preset. */
  allowSavePreset?: boolean;
  initial: StudioConfig;
  onOpenDisplay: (config: StudioConfig) => void;
  onSavePreset?: (name: string, config: StudioConfig) => Promise<void> | void;
};

export function StudioConfigDialog({
  open,
  onOpenChange,
  title,
  description,
  editableDuration,
  allowSavePreset = false,
  initial,
  onOpenDisplay,
  onSavePreset,
}: StudioConfigDialogProps) {
  const [startTime, setStartTime] = useState(initial.startTime);
  const [durationMin, setDurationMin] = useState(initial.durationMin);
  const [notes, setNotes] = useState(initial.notes);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    if (!open) return;
    setStartTime(initial.startTime);
    setDurationMin(initial.durationMin);
    setNotes(initial.notes);
    setPresetName("");
    setShowSave(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial.startTime, initial.durationMin, initial.notes]);

  // Keeps the notes lock in sync with the class interval while the popup is up.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [open]);

  const config: StudioConfig = {
    ...initial,
    startTime,
    durationMin,
    notes,
  };
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

          {editableDuration && (
            <div className="space-y-1.5">
              <Label htmlFor="sd-dur" className="text-xs">
                Class duration (min)
              </Label>
              <Input
                id="sd-dur"
                type="number"
                className="h-10"
                min={MIN_DURATION_MIN}
                value={durationMin}
                onChange={(e) =>
                  setDurationMin(
                    Math.max(MIN_DURATION_MIN, parseInt(e.target.value) || MIN_DURATION_MIN),
                  )
                }
              />
            </div>
          )}

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

          {allowSavePreset && (
            <div className="rounded-xl border border-dashed p-3">
              {!showSave ? (
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setShowSave(true)}
                >
                  Save as preset
                </button>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="sd-preset" className="text-xs">
                    Preset name
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="sd-preset"
                      className="h-9"
                      value={presetName}
                      placeholder="Evening Setup"
                      onChange={(e) => setPresetName(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!presetName.trim() || savingPreset}
                      onClick={async () => {
                        if (!onSavePreset) return;
                        setSavingPreset(true);
                        try {
                          await onSavePreset(presetName.trim(), config);
                          setShowSave(false);
                          setPresetName("");
                        } finally {
                          setSavingPreset(false);
                        }
                      }}
                    >
                      {savingPreset ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
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
