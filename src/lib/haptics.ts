/** Light tap feedback where the browser supports it (Android); iPhone web apps ignore it. */
export function tapHaptic(ms = 10): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}
