ALTER TABLE public.calendar_classes ADD COLUMN IF NOT EXISTS raw_title text;
UPDATE public.calendar_classes SET raw_title = class_name WHERE raw_title IS NULL;
ALTER TABLE public.calendar_classes
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS meet_link,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS duration_min;

CREATE TABLE IF NOT EXISTS public.class_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_key text NOT NULL UNIQUE,
  raw_title text NOT NULL,
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.class_aliases TO service_role;
ALTER TABLE public.class_aliases ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_class_aliases_updated_at ON public.class_aliases;
CREATE TRIGGER update_class_aliases_updated_at
BEFORE UPDATE ON public.class_aliases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();