import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getTimeToLeave, getRouteGeometry } from "@/lib/travel.functions";
import {
  readSnapshot,
  writeSnapshot,
  snapshotFromResult,
  travelPlanKey,
  type TimeToLeaveSnapshot,
  type TravelPlanIdentity,
} from "@/lib/travel-snapshot";

export type TravelPlanStatus = "idle" | "loading" | "ready" | "unavailable";

/**
 * One travel plan per plan identity, calculated once and then kept.
 *
 * The route request happens only when there is no stored snapshot for the
 * current identity (shift + home + version). Nothing else — rerenders, clock
 * ticks, focus, visibility, resize, unrelated state — can trigger it. A
 * failed request never overwrites a stored successful snapshot and is never
 * itself persisted.
 */
export function useTravelPlan(identity: TravelPlanIdentity | null) {
  const fetchPlan = useServerFn(getTimeToLeave);
  const fetchGeometry = useServerFn(getRouteGeometry);

  const key = identity ? travelPlanKey(identity) : null;

  const [snapshot, setSnapshot] = useState<TimeToLeaveSnapshot | null>(() => readSnapshot(key));
  const [status, setStatus] = useState<TravelPlanStatus>(() =>
    key ? (readSnapshot(key) ? "ready" : "idle") : "idle",
  );
  const [reason, setReason] = useState<string | null>(null);

  // Guards against a second request for the same identity within a session.
  const attemptedRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const existing = readSnapshot(key);
    setSnapshot(existing);
    if (existing) setStatus("ready");

    if (!key || !identity) {
      if (!existing) setStatus("idle");
      return;
    }
    const guard = `${key}#${attempt}`;
    if (existing || attemptedRef.current === guard) return;
    attemptedRef.current = guard;

    let cancelled = false;
    setStatus("loading");
    setReason(null);

    (async () => {
      try {
        const res = await fetchPlan({ data: { shift_start_iso: identity.shiftStartIso } });
        if (cancelled) return;
        if (!res || !res.ok) {
          // Failures are transient: never cached, never allowed to replace data.
          setReason(res?.reason ?? "no_route");
          setStatus("unavailable");
          return;
        }
        let geometry: [number, number][] | null = null;
        try {
          const geo = await fetchGeometry({
            data: {
              from_lat: res.home_lat,
              from_lng: res.home_lng,
              to_lat: res.office_lat,
              to_lng: res.office_lng,
            },
          });
          geometry = geo?.coords ?? null;
        } catch {
          geometry = null;
        }
        if (cancelled) return;
        const snap = snapshotFromResult(res, {
          operator: identity.username,
          shiftEndIso: identity.shiftEndIso,
          geometry,
        });
        writeSnapshot(key, snap);
        setSnapshot(snap);
        setStatus("ready");
      } catch {
        if (cancelled) return;
        setReason("network");
        setStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on plan identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  /** Explicit user-initiated recalculation. */
  const recalculate = useCallback(() => setAttempt((n) => n + 1), []);

  return { snapshot, status, reason, recalculate };
}
