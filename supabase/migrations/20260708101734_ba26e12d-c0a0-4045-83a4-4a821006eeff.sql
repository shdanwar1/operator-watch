
UPDATE public.scheduled_shifts SET start_time='10:00:00', end_time='15:00:00' WHERE day_of_week=1;
UPDATE public.scheduled_shifts SET start_time='16:30:00', end_time='21:30:00' WHERE day_of_week=2;
UPDATE public.scheduled_shifts SET start_time='16:30:00', end_time='20:30:00' WHERE day_of_week=3;
DELETE FROM public.scheduled_shifts WHERE day_of_week=4;
