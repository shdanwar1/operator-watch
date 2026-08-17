// Break the Ice — the only questions the Studio Display may show.
// Exactly six strings, rotated deterministically every 15 seconds.

/** The complete, exclusive set of Break the Ice questions. */
export const BREAK_THE_ICE_QUESTIONS: string[] = [
  "What city are you joining from?",
  "What country are you joining from?",
  "What time is it where you are?",
  "Is it morning, afternoon, or evening where you are?",
  "Who is joining us for the first time?",
  "What’s the weather like where you are today?",
];

/**
 * Deterministic 15-second rotation through the six questions.
 * Every synced window shows the same question for the same slot.
 * After question 6, returns to question 1.
 */
export function pickIcebreaker(now: Date = new Date()): string {
  const slot = Math.floor(now.getTime() / 15_000);
  return BREAK_THE_ICE_QUESTIONS[slot % BREAK_THE_ICE_QUESTIONS.length];
}
