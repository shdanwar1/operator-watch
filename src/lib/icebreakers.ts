// Short icebreaker prompts shown before class starts.
// Each prompt: single emoji + one short sentence, readable in <2s.

export type Prompt = {
  emoji: string;
  text: string;
};

export const PROMPTS: Prompt[] = [
  // Greetings
  { emoji: "👋", text: "Welcome everyone!" },
  { emoji: "😊", text: "Great to see you all today." },
  { emoji: "🌞", text: "Hope you're having a wonderful day." },
  { emoji: "✨", text: "Thanks for joining today's class." },
  { emoji: "💙", text: "Let's make today a great session." },
  { emoji: "🌍", text: "Nice to see people from around the world." },
  { emoji: "🎉", text: "Happy you're here." },
  { emoji: "☕", text: "Hope you've got some energy today!" },
  { emoji: "🌸", text: "Let's get ready for a beautiful class." },
  { emoji: "💃", text: "Take a deep breath — we'll begin shortly." },

  // Conversation starters
  { emoji: "😊", text: "How are you feeling today?" },
  { emoji: "🌍", text: "Where are you joining from today?" },
  { emoji: "✨", text: "Is this your first class with us?" },
  { emoji: "☀️", text: "How's your day been so far?" },
  { emoji: "💃", text: "What made you choose today's class?" },
  { emoji: "🎵", text: "Any song stuck in your head today?" },
  { emoji: "☕", text: "Coffee, tea, or just surviving today?" },
  { emoji: "🌦️", text: "What's the weather like where you are?" },
  { emoji: "🌈", text: "What are you looking forward to this week?" },
  { emoji: "🕺", text: "If your mood was a dance style, what would it be?" },

  // Encouragement
  { emoji: "💙", text: "Smile before you begin." },
  { emoji: "✨", text: "Create a relaxed atmosphere." },
  { emoji: "🌸", text: "Make everyone feel welcome." },
  { emoji: "👋", text: "Start with conversation before instruction." },
  { emoji: "💬", text: "Give people a reason to speak." },
  { emoji: "🤝", text: "Small interactions build stronger classes." },
  { emoji: "😊", text: "Energy is contagious." },
  { emoji: "🌞", text: "Keep the first minutes light." },
  { emoji: "🎉", text: "A warm welcome creates a better class." },
  { emoji: "💃", text: "Connection comes before choreography." },
];

/**
 * Deterministically pick 3 non-repeating prompts for the current 15s window.
 * All synced windows show the same trio.
 */
export function pickPromptSet(now: Date = new Date()): Prompt[] {
  const slot = Math.floor(now.getTime() / 15_000);
  const n = PROMPTS.length;
  const stride = 7; // coprime with 30
  const start = (slot * 3) % n;
  const picks: Prompt[] = [];
  const used = new Set<number>();
  let i = 0;
  while (picks.length < 3 && i < n * 2) {
    const idx = (start + i * stride) % n;
    if (!used.has(idx)) {
      used.add(idx);
      picks.push(PROMPTS[idx]);
    }
    i++;
  }
  return picks;
}
