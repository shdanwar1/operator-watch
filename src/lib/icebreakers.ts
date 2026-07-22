// Rotating instructor prompts shown before class starts.
// Categories combined; picker rotates every ~5 seconds and avoids
// immediate repeats.

export type PromptCategory = "greeting" | "starter" | "icebreaker" | "teaching";

export type Prompt = {
  text: string;
  category: PromptCategory;
};

export const PROMPTS: Prompt[] = [
  // Greetings
  { text: "Hello Elizabeth! 👋", category: "greeting" },
  { text: "Hello Laura! 👋", category: "greeting" },
  { text: "Nice to see everyone today! ✨", category: "greeting" },
  { text: "Welcome in — glad you're here.", category: "greeting" },
  { text: "Good to see familiar faces.", category: "greeting" },
  { text: "Say hello to someone new today.", category: "greeting" },

  // Conversation starters
  { text: "How is everyone feeling today?", category: "starter" },
  { text: "Where are you joining us from?", category: "starter" },
  { text: "Has anyone attended before?", category: "starter" },
  { text: "What are you excited for today?", category: "starter" },
  { text: "What's one word to describe your mood?", category: "starter" },
  { text: "Coffee, tea, or water today?", category: "starter" },
  { text: "Any song stuck in your head this morning?", category: "starter" },
  { text: "How's the weather where you are?", category: "starter" },

  // Icebreaker reminders
  { text: "Break the ice.", category: "icebreaker" },
  { text: "Smile — the room follows your energy.", category: "icebreaker" },
  { text: "Create a relaxed atmosphere.", category: "icebreaker" },
  { text: "Don't wait silently — lead the room.", category: "icebreaker" },
  { text: "Connect with everyone.", category: "icebreaker" },
  { text: "Read chat messages out loud.", category: "icebreaker" },

  // Teaching reminders
  { text: "Welcome every participant by name.", category: "teaching" },
  { text: "Create positive energy.", category: "teaching" },
  { text: "Make everyone feel comfortable.", category: "teaching" },
  { text: "Encourage interaction.", category: "teaching" },
  { text: "Start conversations naturally.", category: "teaching" },
  { text: "Keep it light and welcoming.", category: "teaching" },
];

/**
 * Deterministic rotation so every synced window shows the same prompt.
 * Rotates every 5 seconds. Uses a stride that's coprime with the array
 * length so the same prompt doesn't repeat back-to-back.
 */
export function pickPrompt(now: Date = new Date()): Prompt {
  const slot = Math.floor(now.getTime() / 5_000);
  const n = PROMPTS.length;
  // stride coprime with n keeps the walk from repeating soon.
  const stride = 7 % n === 0 ? 11 : 7;
  return PROMPTS[(slot * stride) % n];
}

export const CATEGORY_LABEL: Record<PromptCategory, string> = {
  greeting: "Greeting",
  starter: "Conversation",
  icebreaker: "Icebreaker",
  teaching: "Reminder",
};
