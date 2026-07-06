
CREATE TABLE public.scheduled_shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_shifts TO anon, authenticated;
GRANT ALL ON public.scheduled_shifts TO service_role;

ALTER TABLE public.scheduled_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view scheduled_shifts" ON public.scheduled_shifts FOR SELECT USING (true);
CREATE POLICY "Public can insert scheduled_shifts" ON public.scheduled_shifts FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update scheduled_shifts" ON public.scheduled_shifts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public can delete scheduled_shifts" ON public.scheduled_shifts FOR DELETE USING (true);

ALTER TABLE public.shifts
  ADD COLUMN scheduled_shift_id UUID REFERENCES public.scheduled_shifts(id) ON DELETE SET NULL;
