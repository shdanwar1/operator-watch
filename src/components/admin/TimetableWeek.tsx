import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { opColor } from '@/lib/admin-utils';
import { resumesOnLabel } from '@/domain/timetable-view';
import type { BoardDay } from '@/domain/timetable-week';
import { berlinClock, cardGeometry, HOUR_HEIGHT, layoutCards } from '@/components/timetable/grid';

function Clock({ week }: { week: BoardDay[] }) {
  const [clock, setClock] = useState<ReturnType<typeof berlinClock> | null>(null);
  useEffect(() => {
    const tick = () => setClock(berlinClock(new Date()));
    tick(); const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!clock || !week.some(day => day.date === clock.date)) return null;
  return <div className="tt-now" style={{ top: clock.top }} aria-label={`Current Berlin time ${clock.label}`}><span>{clock.label}</span><i /></div>;
}
export function TimetableWeekSkeleton() { return <Skeleton className="h-[520px] min-w-[1120px]" />; }
export function TimetableWeek({ week }: { week: BoardDay[] }) {
  const [today, setToday] = useState('');
  useEffect(() => {
    const tick = () => setToday(berlinClock(new Date()).date);
    tick(); const timer = setInterval(tick, 60_000); return () => clearInterval(timer);
  }, []);
  return <div className="tt-grid">
    <div className="tt-axis-head" />
    {week.map(day => <header key={day.date} className={cn('tt-day-head', day.date === today && 'tt-today-head')}>
      <h2>{day.weekday}</h2><span>{day.dateLabel}</span>{day.date === today && <strong>Today</strong>}
    </header>)}
    <div className="tt-body" style={{ height: 24 * HOUR_HEIGHT }}>
      <div className="tt-axis">{Array.from({ length: 25 }, (_, hour) => <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>{String(hour).padStart(2,'0')}:00</span>)}</div>
      <div className="tt-days">
        {week.map(day => <section key={day.date} aria-label={`${day.weekday} ${day.dateLabel}`} className={cn('tt-day', day.date === today && 'tt-today')}>
          <ul>{layoutCards(day.inMonth ? day.cards : []).map(({ card, lane, lanes }) => {
            const color = card.assigned ? opColor(card.operatorName) : null;
            const resumes = resumesOnLabel(card.resumesOn);
            return <li key={`${card.date}-${card.sourceSlotId}`} className={cn('tt-card', !card.active && 'tt-suspended')} data-operator-color={color?.name ?? 'neutral'} style={{ ...cardGeometry(card), left: `calc(${lane / lanes * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` }} title={`${card.startTime}–${card.endTime} · ${card.className} · ${card.instructorName} · ${card.operatorName ?? 'Unassigned'}`}>
              <time>{card.startTime}–{card.endTime}{card.endsNextDay ? ' +1 day' : ''}</time>
              <p className="tt-class-name">{card.className}</p>
              <p className="tt-instructor">{card.instructorName}</p>
              <p className="tt-operator"><i />{card.assigned ? card.operatorName : 'Unassigned'}</p>
              {!card.active && <p className="tt-instructor">Suspended{resumes ? ` · ${resumes}` : ''}</p>}
            </li>;
          })}</ul>
        </section>)}
      </div>
      <Clock week={week} />
    </div>
  </div>;
}
