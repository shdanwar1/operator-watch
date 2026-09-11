ALTER TABLE public.calendar_classes
  DROP CONSTRAINT calendar_classes_dmc_class_id_fkey,
  ADD CONSTRAINT calendar_classes_dmc_class_id_fkey
    FOREIGN KEY (dmc_class_id) REFERENCES public.dmc_classes(id) ON DELETE RESTRICT;

ALTER TABLE public.calendar_classes
  DROP CONSTRAINT calendar_classes_dmc_instructor_id_fkey,
  ADD CONSTRAINT calendar_classes_dmc_instructor_id_fkey
    FOREIGN KEY (dmc_instructor_id) REFERENCES public.dmc_instructors(id) ON DELETE RESTRICT;