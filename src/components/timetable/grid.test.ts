import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { berlinClock, cardGeometry, HOUR_HEIGHT, layoutCards } from './grid';
import { opColor } from '@/lib/admin-utils';
import type { BoardCard } from '@/domain/timetable-week';
const source = (p: string) => readFileSync(p, 'utf8');
describe('shared timetable grid', () => {
  it('positions fractional hours on a uniform scale', () => { expect(cardGeometry({ startTime:'12:30', durationMinutes:60 })).toEqual({ top:12.5*HOUR_HEIGHT, height:HOUR_HEIGHT }); });
  it('uses actual duration', () => { expect(cardGeometry({ startTime:'00:00', durationMinutes:45 })).toEqual({ top:0, height:0.75 * HOUR_HEIGHT }); });
  it('clips overnight cards at the day boundary without changing duration', () => { expect(cardGeometry({ startTime:'23:30', durationMinutes:90 }).height).toBe(0.5 * HOUR_HEIGHT); });
  it('uses Berlin summer time', () => { expect(berlinClock(new Date('2026-09-16T11:56:00Z'))).toEqual({date:'2026-09-16',label:'13:56',top:(13*60+56)*HOUR_HEIGHT/60}); });
  it('uses Berlin winter time and date rollover', () => { expect(berlinClock(new Date('2026-12-16T23:30:00Z')).date).toBe('2026-12-17'); expect(berlinClock(new Date('2026-12-16T12:00:00Z')).label).toBe('13:00'); });
  it('keeps operator colors stable and unassigned neutral', () => { expect(opColor('Alex')).toEqual(opColor('Alex')); expect(opColor(null)).toBeNull(); });
  it('separates overlapping cards and reuses lanes at endpoints', () => {
    const cards = [{startTime:'12:00',durationMinutes:60},{startTime:'12:30',durationMinutes:60},{startTime:'13:30',durationMinutes:30}] as BoardCard[];
    expect(layoutCards(cards).map(({lane,lanes})=>[lane,lanes])).toEqual([[0,2],[1,2],[0,1]]);
  });
  it('shares the same view across both routes', () => { for(const file of ['admin.timetable','timetable']) expect(source(`src/routes/${file}.tsx`)).toContain('TimetableView'); });
  it('retains the admin home redirect', () => { expect(source('src/routes/admin.index.tsx')).toContain('to: "/admin/timetable"'); });
  it('places operator timetable third without changing the home route', () => { const nav=source('src/components/AppShell.tsx'); expect(nav.indexOf('label: "Calendar"')).toBeLessThan(nav.indexOf('label: "Shifts"')); expect(nav.indexOf('label: "Shifts"')).toBeLessThan(nav.indexOf('label: "Timetable"')); expect(nav).toContain('to: "/"'); });
  it('keeps source refresh admin protected and board reads gated', () => { const s=source('src/lib/timetable.functions.ts'); expect(s).toContain('await requireAdmin()'); expect(s).toContain('!session.data.siteUnlocked || !session.data.username'); });
  it('keeps long class names to one truncated line', () => { const css=source('src/styles.css'); expect(css).toMatch(/\.tt-class-name[^}]*overflow:hidden[^}]*white-space:nowrap[^}]*text-overflow:ellipsis/); });
  it('shows the shared view refresh control to admins only', () => { const view=source('src/components/timetable/TimetableView.tsx'); expect(view).toContain('{admin && <div className="flex items-center gap-3">'); });
});
