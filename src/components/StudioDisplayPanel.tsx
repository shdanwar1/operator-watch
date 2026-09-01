import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dumbbell, Monitor, Settings2, Sparkles, Trash2, X } from "lucide-react";
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
  type StudioPreset,
  type TemporaryClass,
} from "@/lib/studio-presets";
import { StudioConfigDialog } from "@/components/studio/StudioConfigDialog";
import { getMyPrefs, setMyPrefs, type OperatorPrefs } from "@/lib/prefs.functions";
import { fmtClock } from "@/lib/class-interval";

type DialogState = {
  title: string;
  description?: string;
  editableDuration: boolean;
  allowSavePreset: boolean;
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
  const fetchPrefs = useServerFn(getMyPrefs);
  const savePrefs = useServerFn(setMyPrefs);
  const [prefs, setPrefs] = useState<OperatorPrefs | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [, force] = useState(0);
  const displayWinRef = useRef<Window | null>(null);

  useEffect(() => {
    fetchPrefs()
      .then(setPrefs)
      .catch(() => setPrefs(null));
  }, [fetchPrefs]);

  // Drives temporary-card expiry without a second timer engine.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const presets = prefs?.studioPresets ?? [];

  const tempActive = useMemo(() => {
    if (!temporaryClass) return null;
    return temporaryClassExpired(temporaryClass) ? null : temporaryClass;
  }, [temporaryClass, /* re-evaluate on tick */ force]);

  useEffect(() => {
    if (temporaryClass && !tempActive) onDismissTemporary?.();
  }, [temporaryClass, tempActive, onDismissTemporary]);

  const openDisplay = useCallback(
    (config: StudioConfig) => {
      update({
        startTime: config.startTime,
        durationMin: config.durationMin,
        notes: config.notes,
        className: config.className ?? "",
        teacherName: config.teacherName ?? "",
        timerMode: "next",
      });
      const url =
        config.className || config.teacherName
          ? buildClassDisplayUrl({
              id: config.classId,
              className: config.className ?? "",
              teacherName: config.teacherName ?? "",
              startTime: config.startTime,
              durationMin: config.durationMin,
            })
          : "/display";
      const name = config.classId ? `studio-display-${config.classId}` : "studio-display";
      const win = window.open(url, name, "popup,width=1280,height=800");
      if (win) displayWinRef.current = win;
      setDialog(null);
    },
    [update],
  );

  const persistPresets = useCallback(
    async (next: StudioPreset[]) => {
      const base: OperatorPrefs = { ...(prefs as OperatorPrefs), studioPresets: next };
      setPrefs(base);
      try {
        const saved = await savePrefs({ data: base });
        setPrefs(saved);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save preset");
      }
    },
    [prefs, savePrefs],
  );

  const savePreset = useCallback(
    async (name: string, config: StudioConfig) => {
      if (!prefs) return;
      const next: StudioPreset[] = [
        ...presets,
        {
          id: `p-${Date.now()}`,
          name,
          durationMin: config.durationMin,
          notes: config.notes,
        },
      ];
      await persistPresets(next);
      toast.success(`Preset "${name}" saved`);
    },
    [prefs, presets, persistPresets],
  );

  const openPresetDialog = useCallback(
    (
      opts: {
        title: string;
        durationMin: number;
        editableDuration: boolean;
        allowSavePreset?: boolean;
        notes?: string;
        startTime?: string;
        className?: string;
        teacherName?: string;
        classId?: string;
        description?: string;
      },
    ) => {
      setDialog({
        title: opts.title,
        description: opts.description,
        editableDuration: opts.editableDuration,
        allowSavePreset: opts.allowSavePreset ?? false,
        initial: {
          startTime: opts.startTime ?? state.startTime ?? nowClock(),
          durationMin: opts.durationMin,
          notes: opts.notes ?? "",
          className: opts.className,
          teacherName: opts.teacherName,
          classId: opts.classId,
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
      {tempActive && tempInterval && (
        <Card className="border-2 border-dashed border-primary/40 bg-primary/[0.03]">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold tracking-tight">
                  {tempActive.className || "Class"}
                  {tempActive.teacherName ? ` — ${tempActive.teacherName}` : ""}
                </h3>
                <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                  {fmtClock(tempActive.startTime)} – {fmtClock(tempActive.endTime)} ·{" "}
                  {tempDuration} min
                </p>
              </div>
              {onDismissTemporary && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  aria-label="Dismiss temporary class"
                  onClick={onDismissTemporary}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={tempDefault === "workout" ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() =>
                  openPresetDialog({
                    title: "Workout",
                    durationMin: WORKOUT_MIN,
                    editableDuration: false,
                    ...classOpts,
                  })
                }
              >
                Workout
              </Button>
              <Button
                variant={tempDefault === "ballet" ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() =>
                  openPresetDialog({
                    title: "Ballet",
                    durationMin: BALLET_MIN,
                    editableDuration: false,
                    ...classOpts,
                  })
                }
              >
                Ballet
              </Button>
              <Button
                variant={tempDefault === "custom" ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() =>
                  openPresetDialog({
                    title: "Customize",
                    durationMin: tempDuration,
                    editableDuration: true,
                    allowSavePreset: true,
                    ...classOpts,
                  })
                }
              >
                Customize
              </Button>
            </div>

            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Temporary class · expires after {fmtClock(tempActive.endTime)}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <PresetCard
          icon={<Dumbbell className="h-5 w-5" />}
          title="Workout"
          subtitle="45 minutes"
          onClick={() =>
            openPresetDialog({ title: "Workout", durationMin: WORKOUT_MIN, editableDuration: false })
          }
        />
        <PresetCard
          icon={<Sparkles className="h-5 w-5" />}
          title="Ballet"
          subtitle="60 minutes"
          onClick={() =>
            openPresetDialog({ title: "Ballet", durationMin: BALLET_MIN, editableDuration: false })
          }
        />
        <PresetCard
          icon={<Settings2 className="h-5 w-5" />}
          title="Customize"
          subtitle="Choose duration"
          onClick={() =>
            openPresetDialog({
              title: "Customize",
              durationMin: state.durationMin || BALLET_MIN,
              editableDuration: true,
              allowSavePreset: true,
              notes: "",
            })
          }
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          My presets
        </h2>
        {presets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Saved presets from Customize appear here.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {presets.map((p) => (
              <div key={p.id} className="group relative">
                <PresetCard
                  icon={<Monitor className="h-5 w-5" />}
                  title={p.name}
                  subtitle={`${p.durationMin} minutes`}
                  onClick={() =>
                    openPresetDialog({
                      title: p.name,
                      durationMin: p.durationMin,
                      editableDuration: true,
                      notes: p.notes ?? "",
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`Delete preset ${p.name}`}
                  className="absolute right-2 top-2 rounded-full p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => persistPresets(presets.filter((x) => x.id !== p.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {dialog && (
        <StudioConfigDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={dialog.title}
          description={dialog.description}
          editableDuration={dialog.editableDuration}
          allowSavePreset={dialog.allowSavePreset}
          initial={dialog.initial}
          onOpenDisplay={openDisplay}
          onSavePreset={savePreset}
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
