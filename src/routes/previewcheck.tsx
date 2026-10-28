import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { ClassScheduleCard } from "@/components/ClassScheduleCard";
import type { CalendarClassRow } from "@/lib/gcal.functions";

// TEMPORARY layout-preview screen (deleted after verification).
export const Route = createFileRoute("/previewcheck")({
  component: PreviewCheck,
});

const DATE = "2026-10-28";

function row(
  id: string,
  className: string,
  teacherName: string,
  start_time: string,
  end_time: string,
): CalendarClassRow {
  return {
    id,
    uid: id,
    specific_date: DATE,
    start_time,
    end_time,
    status: "scheduled",
    dmc_class_id: null,
    dmc_instructor_id: null,
    className,
    teacherName,
    scheduled_shift_id: null,
  };
}

const CLASSES: CalendarClassRow[] = [
  row("c1", "Strong Back Yoga", "Ruth Lee", "15:00", "15:45"),
  row("c2", "Yoga for Relaxation", "Ruth Lee", "16:00", "16:45"),
  row("c3", "Long Lines & Full Extension", "Shad Anwar", "17:00", "18:00"),
  row("c4", "Sharp & Clear Footwork", "Alex Rivera", "18:15", "19:15"),
  row("c5", "Glutes and Legs", "Alex Rivera", "19:30", "20:15"),
  row("c6", "Full Body Stretching", "Ruth Lee", "20:30", "21:15"),
];

function PreviewCheck() {
  return (
    <AppShell username="shad" onAir>
      {/* Mirrors the container classes used by the operator Dashboard. */}
      <div className="mx-auto w-full space-y-6 max-w-3xl lg:max-w-[1280px]">
        <ClassScheduleCard classes={CLASSES} now={new Date(2026, 9, 28, 16, 11, 0)} />
      </div>
    </AppShell>
  );
}
