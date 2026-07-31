CREATE TABLE public.calendar_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator text NOT NULL,
  uid text NOT NULL,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  class_name text NOT NULL,
  teacher_name text NOT NULL,
  specific_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  duration_min integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'confirmed',
  meet_link text,
  description text,
  source text NOT NULL DEFAULT 'google_calendar',
  scheduled_shift_id uuid REFERENCES public.scheduled_shifts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator, uid)
);

GRANT ALL ON public.calendar_classes TO service_role;
ALTER TABLE public.calendar_classes ENABLE ROW LEVEL SECURITY;

CREATE INDEX calendar_classes_operator_date_idx
  ON public.calendar_classes (lower(operator), specific_date);

CREATE TRIGGER update_calendar_classes_updated_at
  BEFORE UPDATE ON public.calendar_classes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Rotate every operator PIN to a freshly generated random 4-digit value.
-- No literal PIN is stored in this migration file.
UPDATE public.operators
SET pin_hash = extensions.crypt(
      lpad((floor(random() * 10000))::int::text, 4, '0'),
      extensions.gen_salt('bf')
    ),
    updated_at = now();