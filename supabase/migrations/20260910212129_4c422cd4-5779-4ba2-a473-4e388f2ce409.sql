ALTER TABLE public.calendar_classes DROP COLUMN class_id;
ALTER TABLE public.calendar_classes DROP COLUMN teacher_id;
DROP FUNCTION IF EXISTS public.bump_directory_usage(text, text[]);
DROP TABLE IF EXISTS public.class_aliases;
DROP TABLE IF EXISTS public.classes;
DROP TABLE IF EXISTS public.teachers;