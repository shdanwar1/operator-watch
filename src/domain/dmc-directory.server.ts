/**
 * Canonical DMC directory access (Operation 8) — server only.
 *
 * Everything that needs a class or instructor identity reads it here. The old
 * generic `classes` / `teachers` directories are not consulted and are never
 * written to from this module.
 */
import { dmcInstructorLabel, type DmcOption } from "./dmc-directory";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type DmcDirectory = {
  classes: DmcOption[];
  instructors: DmcOption[];
};

type ClassRow = { id: string; source_class_id: string; class_name: string };
type InstructorRow = {
  id: string;
  source_instructor_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
};

/** Selectable DMC classes and instructors, alphabetical. */
export async function loadDmcDirectory(): Promise<DmcDirectory> {
  const db = await admin();
  const [classesRes, instructorsRes] = await Promise.all([
    db.from("dmc_classes").select("id, source_class_id, class_name"),
    db.from("dmc_instructors").select("id, source_instructor_id, first_name, last_name, title"),
  ]);
  if (classesRes.error) throw new Error(classesRes.error.message);
  if (instructorsRes.error) throw new Error(instructorsRes.error.message);

  const classes = ((classesRes.data ?? []) as ClassRow[])
    .map((r) => ({ id: r.id, name: r.class_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const instructors = ((instructorsRes.data ?? []) as InstructorRow[])
    .map((r) => ({
      id: r.id,
      name: dmcInstructorLabel({
        firstName: r.first_name,
        lastName: r.last_name,
        title: r.title,
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { classes, instructors };
}

/**
 * Row id of each DMC class / instructor, keyed by the source id the timetable
 * slots carry. Read once per sync, never per event.
 */
export async function loadDmcIdsBySourceId(): Promise<{
  classIdBySource: Map<string, string>;
  instructorIdBySource: Map<string, string>;
}> {
  const db = await admin();
  const [classesRes, instructorsRes] = await Promise.all([
    db.from("dmc_classes").select("id, source_class_id"),
    db.from("dmc_instructors").select("id, source_instructor_id"),
  ]);
  if (classesRes.error) throw new Error(classesRes.error.message);
  if (instructorsRes.error) throw new Error(instructorsRes.error.message);
  return {
    classIdBySource: new Map(
      ((classesRes.data ?? []) as { id: string; source_class_id: string }[]).map((r) => [
        r.source_class_id,
        r.id,
      ]),
    ),
    instructorIdBySource: new Map(
      ((instructorsRes.data ?? []) as { id: string; source_instructor_id: string }[]).map((r) => [
        r.source_instructor_id,
        r.id,
      ]),
    ),
  };
}

/** One DMC class by row id, or null. */
export async function findDmcClass(id: string): Promise<DmcOption | null> {
  const db = await admin();
  const { data, error } = await db
    .from("dmc_classes")
    .select("id, class_name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.id as string, name: data.class_name as string } : null;
}

/** One DMC instructor by row id, or null. */
export async function findDmcInstructor(id: string): Promise<DmcOption | null> {
  const db = await admin();
  const { data, error } = await db
    .from("dmc_instructors")
    .select("id, first_name, last_name, title")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    name: dmcInstructorLabel({
      firstName: data.first_name as string | null,
      lastName: data.last_name as string | null,
      title: data.title as string | null,
    }),
  };
}

/**
 * Resolves display names for a batch of rows carrying DMC references
 * (Operation 10). `calendar_classes` no longer stores any class or teacher
 * text: the directory is the only authority. One query per table, never per
 * row; a missing reference resolves to the neutral placeholder.
 */
export async function resolveClassIdentities<
  T extends { dmc_class_id: string | null; dmc_instructor_id: string | null },
>(rows: T[]): Promise<(T & { className: string; teacherName: string })[]> {
  const classIds = [...new Set(rows.map((r) => r.dmc_class_id).filter(Boolean))] as string[];
  const instructorIds = [
    ...new Set(rows.map((r) => r.dmc_instructor_id).filter(Boolean)),
  ] as string[];

  const db = await admin();
  const [classesRes, instructorsRes] = await Promise.all([
    classIds.length
      ? db.from("dmc_classes").select("id, class_name").in("id", classIds)
      : Promise.resolve({ data: [], error: null }),
    instructorIds.length
      ? db
          .from("dmc_instructors")
          .select("id, first_name, last_name, title")
          .in("id", instructorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (classesRes.error) throw new Error(classesRes.error.message);
  if (instructorsRes.error) throw new Error(instructorsRes.error.message);

  const classById = new Map(
    ((classesRes.data ?? []) as { id: string; class_name: string }[]).map((r) => [
      r.id,
      r.class_name,
    ]),
  );
  const instructorById = new Map(
    (
      (instructorsRes.data ?? []) as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        title: string | null;
      }[]
    ).map((r) => [
      r.id,
      dmcInstructorLabel({ firstName: r.first_name, lastName: r.last_name, title: r.title }),
    ]),
  );

  return rows.map((r) => ({
    ...r,
    className: (r.dmc_class_id && classById.get(r.dmc_class_id)) || "—",
    teacherName: (r.dmc_instructor_id && instructorById.get(r.dmc_instructor_id)) || "—",
  }));
}
