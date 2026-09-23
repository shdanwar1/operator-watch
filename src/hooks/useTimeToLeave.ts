import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getTimeToLeave, type TimeToLeaveResult } from "@/lib/travel.functions";

export function useTimeToLeave(shiftStartIso: string | null) {
  const fetchEstimate = useServerFn(getTimeToLeave);
  const requested = useRef<string | null>(null);
  const [result, setResult] = useState<TimeToLeaveResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!shiftStartIso || requested.current === shiftStartIso) return;
    requested.current = shiftStartIso;
    let cancelled = false;
    setLoading(true);
    setResult(null);
    fetchEstimate({ data: { shift_start_iso: shiftStartIso } })
      .then((value) => {
        if (!cancelled) setResult(value);
      })
      .catch(() => {
        if (!cancelled) setResult({ ok: false, reason: "unavailable" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchEstimate, shiftStartIso]);

  return { result, loading };
}