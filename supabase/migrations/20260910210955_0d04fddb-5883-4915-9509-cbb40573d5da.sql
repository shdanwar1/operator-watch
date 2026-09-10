ALTER TABLE public.calendar_classes
  ADD COLUMN IF NOT EXISTS dmc_class_id uuid REFERENCES public.dmc_classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dmc_instructor_id uuid REFERENCES public.dmc_instructors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS calendar_classes_dmc_class_id_idx ON public.calendar_classes (dmc_class_id);
CREATE INDEX IF NOT EXISTS calendar_classes_dmc_instructor_id_idx ON public.calendar_classes (dmc_instructor_id);