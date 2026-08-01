import { expect, test } from "vitest";
import { matchEvent } from "@/lib/gcal-match";
const classes = ["Pilates & Stretching","Back to Basics","Pilates Flow","Absolute Beginners Barre","Yoga Deep Full Body Release","Beginner-Intermediate","Reformer Essentials"].map((n,i)=>({id:String(i),name:n}));
const teachers = ["Anna Lisa Piccolo","Taryn Scott-Kolbe","Max Muster"].map((n,i)=>({id:"t"+i,name:n}));
const cases: [string, string|null, string|null][] = [
  ["Pilates & Stretching - Taryn Scott-Kolbe","Pilates & Stretching","Taryn Scott-Kolbe"],
  ["pilates   &   stretching - taryn scott kolbe","Pilates & Stretching","Taryn Scott-Kolbe"],
  ["Pilates Stretching - annalisa piccolo","Pilates & Stretching","Anna Lisa Piccolo"],
  ["Pilates and Stretching [Recorded] - Anna-Lisa Piccolo","Pilates & Stretching","Anna Lisa Piccolo"],
  ["Back to Basics (Slow and Easy) - ANNA LISA PICCOLO","Back to Basics","Anna Lisa Piccolo"],
  ["Pilates Flow (Advanced) - Taryn Scott-Kolbe","Pilates Flow","Taryn Scott-Kolbe"],
  ["Absolute Beginners Barre - Beginners Welcome - Max Muster","Absolute Beginners Barre","Max Muster"],
  ["Yoga Deep Full Body Release (45 min) - Max Muster","Yoga Deep Full Body Release","Max Muster"],
  ["Beginner Intermediate - Max Muster","Beginner-Intermediate","Max Muster"],
  ["Beginner — Intermediate - Max Muster","Beginner-Intermediate","Max Muster"],
  ["Pilates Flow | Taryn Scott-Kolbe","Pilates Flow","Taryn Scott-Kolbe"],
  ["Reformer Essentials (Live) - Max Muster","Reformer Essentials","Max Muster"],
  ["Gym", null, null],
  ["Birthday party with friends", null, null],
  ["Dentist appointment - 10am", null, null],
  ["Flight to Munich - Lufthansa", null, null],
];
test("matching", () => {
  const bad: string[] = [];
  for (const [title, cls, tea] of cases) {
    const { result, log } = matchEvent(title, classes, teachers);
    const ok = cls === null ? result === null : result?.className === cls && result?.teacherName === tea;
    if (!ok) bad.push(`${title} => ${JSON.stringify(result)} (${log.confidence}% ${log.reason})`);
  }
  expect(bad).toEqual([]);
});
