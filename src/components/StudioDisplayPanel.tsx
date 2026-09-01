import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dumbbell, Sparkles, X } from "lucide-react";
import { useStudioDisplay } from "@/hooks/useStudioDisplay";
import { buildClassDisplayUrl } from "@/lib/studio-display";
import {
  BALLET_MIN,
  WORKOUT_MIN,
  defaultPresetIdFor,
  temporaryClassDurationMin,
  temporaryClassExpired,
  temporaryClassInterval,
  type StudioConfig,
  type TemporaryClass,
} from "@/lib/studio-presets";
import { StudioConfigDialog } from "@/components/studio/StudioConfigDialog";
import { ActiveDisplayCard } from "@/components/studio/ActiveDisplayCard";
import { fmtClock } from "@/lib/class-interval";

type DialogState = {
  title: string;
  description?: string;
  initial: StudioConfig;
} | null;

function nowClock() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function StudioDisplayPanel({
  temporaryClass,
  onDismissTemporary,
}: {
  temporaryClass?: TemporaryClass | null;
  onDismissTemporary?: () => void;
}) {
  const { state, update, ready } = useStudioDisplay("control");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [, force] = useState(0);
  const displayWinRef = useRef<Window | null>(null);

  // Drives temporary-card expiry without a second timer engine.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const tempActive = useMemo(() => {
    if (!temporaryClass) return null;
    return temporaryClassExpired(temporaryClass) ? null : temporaryClass;
  }, [temporaryClass, /* re-evaluate on tick */ force]);

  useEffect(() => {
    if (temporaryClass && !tempActive) onDismissTemporary?.();
  }, [temporaryClass, tempActive, onDismissTemporary]);

  // A class arriving from Shift Overview becomes the one active session right
  // away — no popup, no re-entering class data. Adopted once per class id so
  // ending the session doesn't immediately restart it.
  const adoptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !tempActive) return;
    if (adoptedRef.current === tempActive.classId) return;
    adoptedRef.current = tempActive.classId;
    update({
      startTime: tempActive.startTime,
      durationMin: temporaryClassDurationMin(tempActive),
      notes: "",
      className: tempActive.className,
      teacherName: tempActive.teacherName,
      classId: tempActive.classId,
      classDate: tempActive.date,
      endTime: tempActive.endTime,
      presetLabel: "",
      active: true,
      timerMode: "next",
    });
  }, [ready, tempActive, update]);

  /** Focuses the one display window, or opens it when it isn't there. */
  const focusOrOpen = useCallback(
    (config: {
      startTime: string;
      durationMin: number;
      className?: string;
      teacherName?: string;
      classId?: string;
    }) => {
      const existing = displayWinRef.current;
      if (existing && !existing.closed) {
        existing.focus();
        return;
      }
      const url =
        config.className || config.teacherName
          ? buildClassDisplayUrl({
              id: config.classId || undefined,
              className: config.className ?? "",
              teacherName: config.teacherName ?? "",
              startTime: config.startTime,
              durationMin: config.durationMin,
            })
          : "/display";
      // One physical display → one named window, reused on every launch.
      const win = window.open(url, "studio-display", "popup,width=1280,height=800");
      if (win) {
        displayWinRef.current = win;
        win.focus();
      }
    },
    [],
  );

  const openDisplay = useCallback(
    (config: StudioConfig) => {
      update({
        startTime: config.startTime,
        durationMin: config.durationMin,
        notes: config.notes,
        className: config.className ?? "",
        teacherName: config.teacherName ?? "",
        classId: config.classId ?? "",
        classDate: "",
        endTime: "",
        presetLabel: config.presetLabel ?? "",
        active: true,
        timerMode: "next",
      });
      focusOrOpen(config);
      setDialog(null);
    },
    [update, focusOrOpen],
  );

  const openPresetDialog = useCallback(
    (opts: {
      title: string;
      durationMin: number;
      notes?: string;
      startTime?: string;
      className?: string;
      teacherName?: string;
      classId?: string;
      description?: string;
    }) => {
      setDialog({
        title: opts.title,
        description: opts.description,
        initial: {
          startTime: opts.startTime ?? state.startTime ?? nowClock(),
          durationMin: opts.durationMin,
          notes: opts.notes ?? "",
          className: opts.className,
          teacherName: opts.teacherName,
          classId: opts.classId,
          presetLabel: opts.title,
        },
      });
    },
    [state.startTime],
  );

  if (!ready) return null;

  const tempDuration = tempActive ? temporaryClassDurationMin(tempActive) : 0;
  const tempDefault = tempActive ? defaultPresetIdFor(tempDuration) : "custom";
  const tempInterval = tempActive ? temporaryClassInterval(tempActive) : null;

  const classOpts = tempActive
    ? {
        className: tempActive.className,
        teacherName: tempActive.teacherName,
        classId: tempActive.classId,
        startTime: tempActive.startTime,
        description: `${tempActive.className}${
          tempActive.teacherName ? ` — ${tempActive.teacherName}` : ""
        }`,
      }
    : {};

  return (
    <div className="space-y-6">
      {state.active && (
        <ActiveDisplayCard
          state={state}
          onNotesChange={(notes) => update({ notes })}
          onOpenDisplay={() =>
            focusOrOpen({
              startTime: state.startTime,
              durationMin: state.durationMin,
              className: state.className,
              teacherName: state.teacherName,
              classId: state.classId,
            })
          }
          onEndSession={() => update({ active: false })}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <PresetCard
          icon={<Dumbbell className="h-5 w-5" />}
          title="Workout"
          subtitle="45 minutes"
          onClick={() => openPresetDialog({ title: "Workout", durationMin: WORKOUT_MIN })}
        />
        <PresetCard
          icon={<Sparkles className="h-5 w-5" />}
          title="Ballet"
          subtitle="60 minutes"
          onClick={() => openPresetDialog({ title: "Ballet", durationMin: BALLET_MIN })}
        />
      </div>

      {dialog && (
        <StudioConfigDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={dialog.title}
          description={dialog.description}
          initial={dialog.initial}
          onOpenDisplay={openDisplay}
        />
      )}
    </div>
  );
}

function PresetCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col items-start gap-3 rounded-2xl border bg-card p-5 text-left transition-colors hover:border-foreground/30 hover:bg-accent/40"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold tracking-tight">{title}</span>
        <span className="block text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}
