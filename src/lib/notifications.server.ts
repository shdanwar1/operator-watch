/**
 * Server-only notification/shift state reconciliation.
 *
 * The push system derives its jobs from live shift data, so the only durable
 * notification state is `operator_travel_plans` (time-to-leave input) and
 * `push_notification_deliveries` (what has been claimed/sent). Both can go
 * stale when a shift is cancelled, retimed or removed by Google Calendar.
 *
 * Everything here is idempotent: running it repeatedly converges on
 * "notifications match the current shift state" and never creates duplicates.
 */
import { berlinInstant } from "./push-time";
import { sameOperator } from "@/domain/operator-identity";

type ShiftRow = {
  id: string;
  assigned_operator: string | null;
  specific_date: string;
  start_time: string;
  status: string;
};

function berlinDay(offsetDays: number, base = Date.now()): string {
  return new Date(base + offsetDays * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Europe/Berlin",
  });
}

/** Start instants (ms) of every currently deliverable shift of one operator. */
export async function activeShiftStartSet(
  operatorId: string,
  windowDays = 2,
): Promise<Set<number>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: op } = await supabaseAdmin
    .from("operators")
    .select("username, is_active")
    .eq("id", operatorId)
    .maybeSingle();
  const row = op as { username: string; is_active: boolean } | null;
  if (!row || row.is_active === false) return new Set();

  const { data: shifts } = await supabaseAdmin
    .from("scheduled_shifts")
    .select("id, assigned_operator, specific_date, start_time, status")
    .gte("specific_date", berlinDay(-1))
    .lte("specific_date", berlinDay(windowDays));

  const set = new Set<number>();
  for (const s of (shifts ?? []) as ShiftRow[]) {
    if (s.status === "cancelled" || !s.assigned_operator) continue;
    if (!sameOperator(s.assigned_operator, row.username)) continue;
    const start = berlinInstant(s.specific_date, s.start_time);
    if (start) set.add(start.getTime());
  }
  return set;
}

/**
 * Brings the notification state in line with the current shift data.
 *
 * - drops travel plans whose shift no longer exists at that time (cancelled,
 *   removed or retimed), which kills the associated "Time to leave" job,
 * - marks still-pending delivery rows for those shifts as `cancelled`, so the
 *   dispatcher's claim can never resurrect them,
 * - best-effort closes a notification that was already displayed.
 */
export async function reconcileShiftNotifications(): Promise<{
  plansRemoved: number;
  deliveriesCancelled: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = Date.now();

  const { data: operators } = await supabaseAdmin
    .from("operators")
    .select("id, username, is_active");
  const ops = (operators ?? []) as { id: string; username: string; is_active: boolean }[];
  const idByName = new Map<string, string>();
  const activeIds = new Set<string>();
  for (const o of ops) {
    idByName.set(o.username.toLowerCase(), o.id);
    if (o.is_active !== false) activeIds.add(o.id);
  }

  const { data: shiftRows } = await supabaseAdmin
    .from("scheduled_shifts")
    .select("id, assigned_operator, specific_date, start_time, status")
    .gte("specific_date", berlinDay(-1))
    .lte("specific_date", berlinDay(8));

  const validStarts = new Map<string, Set<number>>(); // operatorId → start ms
  const startByShiftId = new Map<string, { operatorId: string; ms: number } | null>();
  for (const s of (shiftRows ?? []) as ShiftRow[]) {
    const opId = s.assigned_operator ? idByName.get(s.assigned_operator.toLowerCase()) : undefined;
    const start = berlinInstant(s.specific_date, s.start_time);
    const deliverable = !!opId && activeIds.has(opId) && s.status !== "cancelled" && !!start;
    startByShiftId.set(s.id, deliverable ? { operatorId: opId!, ms: start!.getTime() } : null);
    if (!deliverable) continue;
    const set = validStarts.get(opId!) ?? new Set<number>();
    set.add(start!.getTime());
    validStarts.set(opId!, set);
  }

  // --- stale travel plans (the source of the "Time to leave" job) ---
  const { data: plans } = await supabaseAdmin
    .from("operator_travel_plans")
    .select("id, operator_id, shift_start_at")
    .gte("shift_start_at", new Date(now - 60 * 60_000).toISOString());

  const staleplanIds: string[] = [];
  for (const p of (plans ?? []) as { id: string; operator_id: string; shift_start_at: string }[]) {
    const ms = Date.parse(p.shift_start_at);
    if (!validStarts.get(p.operator_id)?.has(ms)) staleplanIds.push(p.id);
  }
  if (staleplanIds.length) {
    await supabaseAdmin.from("operator_travel_plans").delete().in("id", staleplanIds);
  }

  // --- delivery rows that no longer match a live shift ---
  const { data: deliveries } = await supabaseAdmin
    .from("push_notification_deliveries")
    .select("id, operator_id, notification_key, status, sent_at")
    .in("status", ["pending", "sending", "failed", "sent", "partial"])
    .gte("scheduled_at", new Date(now - 6 * 60 * 60_000).toISOString());

  const rows = (deliveries ?? []) as {
    id: string;
    operator_id: string;
    notification_key: string;
    status: string;
    sent_at: string | null;
  }[];

  const cancelIds: string[] = [];
  const closeTags: { operatorId: string; tag: string }[] = [];

  for (const d of rows) {
    const key = d.notification_key;
    let valid = true;
    if (key.startsWith("leave:")) {
      const ms = Date.parse(key.slice("leave:".length));
      valid = Number.isFinite(ms) ? !!validStarts.get(d.operator_id)?.has(ms) : true;
    } else if (key.startsWith("start:") || key.startsWith("checkin:")) {
      const prefix = key.startsWith("start:") ? "start:" : "checkin:";
      const [shiftId, iso] = key.slice(prefix.length).split("@");
      const live = startByShiftId.get(shiftId);
      if (live === null) valid = false;
      else if (live && iso) valid = live.ms === Date.parse(iso);
      // unknown shift id (outside the window) → leave alone
    }

    if (valid) continue;

    if (d.status === "pending" || d.status === "sending" || d.status === "failed") {
      cancelIds.push(d.id);
    } else if (d.sent_at && now - Date.parse(d.sent_at) < 2 * 60 * 60_000) {
      closeTags.push({ operatorId: d.operator_id, tag: key });
    }
  }

  if (cancelIds.length) {
    await supabaseAdmin
      .from("push_notification_deliveries")
      .update({ status: "cancelled", locked_at: null } as never)
      .in("id", cancelIds);
  }

  // Already-displayed notification for a shift that no longer stands: ask the
  // service worker to close it. Purely best-effort.
  if (closeTags.length) {
    try {
      const { sendToOperator } = await import("./push.server");
      for (const c of closeTags) {
        await sendToOperator(c.operatorId, {
          type: "close",
          tag: c.tag,
          title: "",
          body: "",
        });
      }
    } catch (err) {
      console.error("[notifications] close push failed", err);
    }
  }

  return { plansRemoved: staleplanIds.length, deliveriesCancelled: cancelIds.length };
}
