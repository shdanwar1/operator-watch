CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_scheduled
  ON public.shifts (scheduled_shift_id)
  WHERE check_out_at IS NULL AND scheduled_shift_id IS NOT NULL;