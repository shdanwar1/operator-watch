
CREATE TABLE public.shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  operator_name TEXT NOT NULL,
  check_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_out_at TIMESTAMPTZ,
  live_streams_count INTEGER NOT NULL DEFAULT 0,
  dance_teachers TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts TO anon, authenticated;
GRANT ALL ON public.shifts TO service_role;

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view shifts" ON public.shifts FOR SELECT USING (true);
CREATE POLICY "Public can insert shifts" ON public.shifts FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update shifts" ON public.shifts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public can delete shifts" ON public.shifts FOR DELETE USING (true);

CREATE INDEX shifts_check_in_at_idx ON public.shifts (check_in_at DESC);
