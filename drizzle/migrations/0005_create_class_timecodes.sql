CREATE TABLE public.class_timecodes (
  class_id text PRIMARY KEY,
  operator text NOT NULL,
  class_name text,
  teacher_name text,
  class_date date,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.class_timecodes TO service_role;
ALTER TABLE public.class_timecodes ENABLE ROW LEVEL SECURITY;