
ALTER TABLE public.scheduled_shifts ADD COLUMN IF NOT EXISTS specific_date date;
CREATE INDEX IF NOT EXISTS scheduled_shifts_specific_date_idx ON public.scheduled_shifts (specific_date);

-- Revert recurring template to previous values
UPDATE public.scheduled_shifts SET start_time='16:30:00', end_time='19:30:00' WHERE day_of_week=1 AND specific_date IS NULL;
UPDATE public.scheduled_shifts SET start_time='16:30:00', end_time='20:45:00' WHERE day_of_week=3 AND specific_date IS NULL;
INSERT INTO public.scheduled_shifts (day_of_week, start_time, end_time)
  SELECT 4, '14:00:00', '21:30:00'
  WHERE NOT EXISTS (SELECT 1 FROM public.scheduled_shifts WHERE day_of_week=4 AND specific_date IS NULL);

-- One-off shifts for next week matching the calendar
INSERT INTO public.scheduled_shifts (day_of_week, start_time, end_time, specific_date, label) VALUES
  (1, '10:00:00', '15:00:00', '2026-07-13', 'Week of Jul 13'),
  (2, '16:30:00', '21:30:00', '2026-07-14', 'Week of Jul 13'),
  (3, '16:30:00', '20:30:00', '2026-07-15', 'Week of Jul 13');
