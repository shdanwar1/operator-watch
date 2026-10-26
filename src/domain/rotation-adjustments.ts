import { z } from "zod";
import { berlinWallToInstant } from "./schedule-overrides";
import type { ShiftBucket } from "./shift-rotation";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const wallDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/).refine((v) => {
  const [date] = v.split("T");
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}, "Enter a valid date");
export const adjustmentSchema = z.object({
  operator: z.string().trim().min(1),
  validFrom: wallDateTime,
  validUntil: wallDateTime,
  bucket: z.enum(["day", "night", "weekend"]).nullable().default(null),
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  startFrom: clock.nullable().default(null),
  startTo: clock.nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
}).refine((v) => v.validUntil > v.validFrom, { message: "Until must be after From", path: ["validUntil"] })
  .refine((v) => !v.startFrom || !v.startTo || v.startTo > v.startFrom, { message: "Window end must be after its start", path: ["startTo"] });
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type RotationAdjustment = {
  id: string; valid_from: string; valid_until: string; bucket: ShiftBucket | null;
  weekday: number | null; start_from: string | null; start_to: string | null;
  operator: string; note: string | null; created_at: string;
};
export function validateAdjustment(input: AdjustmentInput, operators: string[]) {
  const value = adjustmentSchema.parse(input);
  if (!operators.includes(value.operator)) throw new Error("Choose an existing active operator");
  const instant = (v: string) => {
    const [date, time] = v.split("T");
    return new Date(berlinWallToInstant(date, time)).toISOString();
  };
  return { operator: value.operator, valid_from: instant(value.validFrom), valid_until: instant(value.validUntil),
    bucket: value.bucket, weekday: value.weekday, start_from: value.startFrom, start_to: value.startTo, note: value.note };
}
export const NOVEMBER_ADJUSTMENTS: RotationAdjustment[] = [
  { id: "11a20260-0000-4000-8000-000000000001", valid_from: "2026-10-31T23:00:00Z", valid_until: "2026-11-30T23:00:00Z", bucket: "day", weekday: 2, start_from: "12:00", start_to: "21:00", operator: "Alex", note: "Nov 2026: Alex takes the Tuesday classes 12:30–20:15", created_at: "2026-10-26T10:29:00Z" },
  { id: "11b20260-0000-4000-8000-000000000002", valid_from: "2026-10-31T23:00:00Z", valid_until: "2026-11-01T17:30:00Z", bucket: "weekend", weekday: null, start_from: null, start_to: null, operator: "Victor", note: "Handover Sun 1 Nov: Victor until Ruth's 17:15 class, Alex from 18:30", created_at: "2026-10-26T10:29:00Z" },
];
/** Stable seed IDs are also the database conflict key. */
export function missingAdjustmentSeeds(existingIds: string[]) {
  const existing = new Set(existingIds);
  return NOVEMBER_ADJUSTMENTS.filter((row) => !existing.has(row.id));
}