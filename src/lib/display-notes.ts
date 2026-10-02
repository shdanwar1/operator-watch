/**
 * Notes for display lifecycle: a local draft is only published to the shared
 * Studio Display state on Send, and cleared on Cancel. Typing never touches
 * shared state.
 */

/** The active session alone decides whether the notes editor is usable. */
export function notesControlAvailable(state: { active: boolean }): boolean {
  return state.active === true;
}

/** Returns the patch to publish, or null when the draft is empty. */
export function sendNotePatch(draft: string): { notes: string } | null {
  const text = draft.trim();
  return text ? { notes: text } : null;
}

export function cancelNotePatch(): { notes: string } {
  return { notes: "" };
}
