// Curated icebreaker sets shown before class begins.
// Rotates every ~30s so the instructor always has a fresh prompt in view.

export type IcebreakerItem = {
  icon: "globe" | "smile" | "heart" | "sparkles" | "music" | "sun";
  text: string;
};

export type IcebreakerSet = {
  greeting: string; // shown as the big heading, e.g. "Hello everyone! 👋"
  items: IcebreakerItem[];
  tip: string;
};

export const ICEBREAKERS: IcebreakerSet[] = [
  {
    greeting: "Hello everyone! 👋",
    items: [
      { icon: "globe", text: "Where are you joining us from today?" },
      { icon: "smile", text: "How is everyone feeling today?" },
      { icon: "heart", text: "Make everyone feel welcome and comfortable." },
    ],
    tip: "Break the ice, create a relaxed atmosphere, and connect with your participants.",
  },
  {
    greeting: "Great to see you! 🌿",
    items: [
      { icon: "sun",  text: "What is one word to describe your mood right now?" },
      { icon: "globe", text: "What city are you dancing from today?" },
      { icon: "smile", text: "Give a wave to the person who just joined." },
    ],
    tip: "Greet participants by name — it instantly makes the room feel personal.",
  },
  {
    greeting: "Welcome in! ✨",
    items: [
      { icon: "sparkles", text: "What are you looking forward to in today's class?" },
      { icon: "music",    text: "Any song stuck in your head this morning?" },
      { icon: "heart",    text: "Take a slow, deep breath together." },
    ],
    tip: "Lead the moment — do not just sit and wait for people to arrive.",
  },
  {
    greeting: "Nice to have you here! 💫",
    items: [
      { icon: "smile", text: "What made you smile in the last 24 hours?" },
      { icon: "sun",   text: "Coffee, tea, or water today?" },
      { icon: "globe", text: "Any first-timers with us today?" },
    ],
    tip: "Keep it light and welcoming — questions with easy answers work best.",
  },
  {
    greeting: "Let's warm up together! 🔥",
    items: [
      { icon: "music",    text: "What kind of music gets you moving?" },
      { icon: "sparkles", text: "Roll your shoulders and shake out your hands." },
      { icon: "heart",    text: "Say hi to someone whose name you recognise." },
    ],
    tip: "Movement + words = comfort. Get the room breathing and gently moving.",
  },
  {
    greeting: "Hello beautiful people! 🌸",
    items: [
      { icon: "globe", text: "Tell us your city in the chat." },
      { icon: "sun",   text: "How is the weather where you are?" },
      { icon: "smile", text: "Wave hello to the camera." },
    ],
    tip: "Reading the chat out loud makes remote participants feel seen.",
  },
];

/** Deterministic rotation so all synced windows show the same set. */
export function pickIcebreaker(now: Date = new Date()): IcebreakerSet {
  const slot = Math.floor(now.getTime() / 30_000); // rotate every 30s
  return ICEBREAKERS[slot % ICEBREAKERS.length];
}
