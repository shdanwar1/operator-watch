ALTER TABLE public.operator_travel_plans
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.scheduled_shifts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS operator_travel_plans_shift_idx
  ON public.operator_travel_plans (shift_id) WHERE shift_id IS NOT NULL;

UPDATE public.operator_travel_plans p
SET shift_id = s.id
FROM public.operators o, public.scheduled_shifts s
WHERE p.shift_id IS NULL
  AND o.id = p.operator_id
  AND lower(s.assigned_operator) = lower(o.username)
  AND ((s.specific_date + s.start_time) AT TIME ZONE 'Europe/Berlin') = p.shift_start_at;