CREATE TABLE public.dmc_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_class_id text NOT NULL UNIQUE,
  class_name text NOT NULL,
  category text,
  level text,
  description text,
  trailer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.dmc_classes TO service_role;
ALTER TABLE public.dmc_classes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.dmc_instructors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_instructor_id text NOT NULL UNIQUE,
  first_name text,
  last_name text,
  title text,
  bio_info text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.dmc_instructors TO service_role;
ALTER TABLE public.dmc_instructors ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.dmc_timetable_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slot_id text NOT NULL UNIQUE,
  source_class_id text NOT NULL,
  source_instructor_id text NOT NULL,
  day_local smallint NOT NULL,
  schedule_key text NOT NULL,
  start_time_local text NOT NULL,
  duration_minutes integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  resumes_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dmc_slot_day_range CHECK (day_local >= 0 AND day_local <= 6),
  CONSTRAINT dmc_slot_duration_positive CHECK (duration_minutes > 0),
  CONSTRAINT dmc_slot_schedule_key_format CHECK (schedule_key ~ '^(sun|mon|tue|wed|thu|fri|sat)[0-2][0-9][0-5][0-9]$')
);
GRANT ALL ON public.dmc_timetable_slots TO service_role;
ALTER TABLE public.dmc_timetable_slots ENABLE ROW LEVEL SECURITY;

CREATE INDEX dmc_timetable_slots_day_idx ON public.dmc_timetable_slots (day_local, start_time_local);

CREATE TRIGGER update_dmc_classes_updated_at BEFORE UPDATE ON public.dmc_classes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_dmc_instructors_updated_at BEFORE UPDATE ON public.dmc_instructors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_dmc_timetable_slots_updated_at BEFORE UPDATE ON public.dmc_timetable_slots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();