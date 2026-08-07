import { useCallback, useEffect, useRef } from "react";

/**
 * Collapses a burst of rapid calls into a single trailing call. Used to fold
 * a flurry of realtime database events (e.g. every row a calendar sync
 * touches) into one refresh instead of one per row.
 */
export function useDebouncedCallback(fn: () => void, delayMs: number): () => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(), delayMs);
  }, [delayMs]);
}
