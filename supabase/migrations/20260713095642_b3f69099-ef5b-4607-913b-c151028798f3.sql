ALTER TABLE public.scheduled_shifts
  ADD COLUMN IF NOT EXISTS assigned_operator text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'assigned',
  ADD COLUMN IF NOT EXISTS notes text;