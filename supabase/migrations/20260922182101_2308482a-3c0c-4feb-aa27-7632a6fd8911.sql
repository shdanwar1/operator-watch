CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_unscheduled_per_operator
ON public.shifts (lower(operator_name))
WHERE check_out_at IS NULL AND scheduled_shift_id IS NULL;