import type { BoardCard } from '@/domain/timetable-week';
import { berlinDate } from '@/domain/timetable-week';
import { minutesOfDay } from '@/domain/timetable-view';
export const HOUR_HEIGHT = 64;
export function cardGeometry(card: Pick<BoardCard, 'startTime' | 'durationMinutes'>) {
  const start = minutesOfDay(card.startTime);
  return { top: start * HOUR_HEIGHT / 60, height: Math.min(card.durationMinutes, 1440 - start) * HOUR_HEIGHT / 60 };
}
export function berlinClock(now: Date) {
  const label = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return { date: berlinDate(now), label, top: minutesOfDay(label) * HOUR_HEIGHT / 60 };
}
/** Connected overlap groups share lanes; touching endpoints do not overlap. */
export function layoutCards(cards: BoardCard[]) {
  const sorted = [...cards].sort((a,b) => minutesOfDay(a.startTime)-minutesOfDay(b.startTime));
  const result: { card: BoardCard; lane: number; lanes: number }[] = [];
  let group: typeof result = [], ends: number[] = [], groupEnd = -1;
  const flush = () => { for (const item of group) result.push({ ...item, lanes: ends.length }); group = []; ends = []; };
  for (const card of sorted) {
    const start = minutesOfDay(card.startTime);
    if (start >= groupEnd) flush();
    let lane = ends.findIndex(end => end <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = start + card.durationMinutes;
    groupEnd = Math.max(...ends);
    group.push({ card, lane, lanes: 1 });
  }
  flush(); return result;
}
