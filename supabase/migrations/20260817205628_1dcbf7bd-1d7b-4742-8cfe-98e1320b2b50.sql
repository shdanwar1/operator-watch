CREATE OR REPLACE FUNCTION public.bump_directory_usage(p_table text, p_names text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  n text;
BEGIN
  IF p_table NOT IN ('classes', 'teachers') THEN
    RAISE EXCEPTION 'Invalid directory table: %', p_table;
  END IF;
  IF p_names IS NULL THEN
    RETURN;
  END IF;

  FOREACH n IN ARRAY p_names LOOP
    IF n IS NULL OR btrim(n) = '' THEN
      CONTINUE;
    END IF;
    IF p_table = 'classes' THEN
      INSERT INTO public.classes (name, usage_count, last_used_at)
      VALUES (n, 1, now())
      ON CONFLICT (name) DO UPDATE
        SET usage_count = public.classes.usage_count + 1,
            last_used_at = now();
    ELSE
      INSERT INTO public.teachers (name, usage_count, last_used_at)
      VALUES (n, 1, now())
      ON CONFLICT (name) DO UPDATE
        SET usage_count = public.teachers.usage_count + 1,
            last_used_at = now();
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.bump_directory_usage(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_directory_usage(text, text[]) TO service_role;