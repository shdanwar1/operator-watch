-- 1. Backfill missing external_event_id for manually created scheduled shifts
UPDATE public.scheduled_shifts
SET external_event_id = 'manual:'
  || lower(coalesce(nullif(btrim(assigned_operator), ''), 'unassigned'))
  || ':shift:' || to_char(specific_date, 'YYYY-MM-DD')
  || ':' || to_char(start_time, 'HH24MI')
WHERE (external_event_id IS NULL OR btrim(external_event_id) = '')
  AND specific_date IS NOT NULL;

-- Any remaining (dateless) rows get a stable id from their uuid
UPDATE public.scheduled_shifts
SET external_event_id = 'manual:legacy:' || id::text
WHERE external_event_id IS NULL OR btrim(external_event_id) = '';

-- De-duplicate defensively before adding the unique index
UPDATE public.scheduled_shifts s
SET external_event_id = s.external_event_id || ':' || s.id::text
FROM (
  SELECT id, row_number() OVER (PARTITION BY external_event_id ORDER BY created_at, id) AS rn
  FROM public.scheduled_shifts
) d
WHERE d.id = s.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_shifts_external_event_id_key
  ON public.scheduled_shifts (external_event_id);

-- 2. specific_date is the single source of truth for when a shift happens
ALTER TABLE public.scheduled_shifts ALTER COLUMN specific_date SET NOT NULL;

-- 3. day_of_week becomes derived, never stored independently
ALTER TABLE public.scheduled_shifts DROP COLUMN day_of_week;
ALTER TABLE public.scheduled_shifts
  ADD COLUMN day_of_week smallint
  GENERATED ALWAYS AS (EXTRACT(DOW FROM specific_date)::smallint) STORED;

-- 4. Teacher names live only inside the classes JSON on attendance rows
ALTER TABLE public.shifts DROP COLUMN IF EXISTS dance_teachers;

-- 5. Remove the magic word feature completely
DROP FUNCTION IF EXISTS public.verify_operator_magic(text, text);
DROP FUNCTION IF EXISTS public.find_operator_by_magic(text);
DROP FUNCTION IF EXISTS public.set_operator_magic(uuid, text);
DROP FUNCTION IF EXISTS public.admin_update_operator(uuid, text, text, text);

ALTER TABLE public.operators DROP COLUMN IF EXISTS magic_word_hash;

CREATE OR REPLACE FUNCTION public.admin_update_operator(
  p_id uuid,
  p_username text DEFAULT NULL::text,
  p_pin text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  UPDATE public.operators SET
    username = COALESCE(NULLIF(p_username, ''), username),
    pin_hash = CASE WHEN p_pin IS NOT NULL AND p_pin <> '' THEN crypt(p_pin, gen_salt('bf')) ELSE pin_hash END,
    updated_at = now()
  WHERE id = p_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_operator(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_operator(uuid, text, text) TO service_role;

-- admin_create_operator no longer needs to touch magic_word_hash
CREATE OR REPLACE FUNCTION public.admin_create_operator(p_username text, p_pin text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE new_id uuid;
BEGIN
  IF p_username IS NULL OR btrim(p_username) = '' THEN
    RAISE EXCEPTION 'Username is required';
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;
  IF EXISTS (SELECT 1 FROM public.operators WHERE lower(username) = lower(p_username)) THEN
    RAISE EXCEPTION 'This username is already in use.';
  END IF;
  INSERT INTO public.operators (username, pin_hash, is_admin)
  VALUES (p_username, crypt(p_pin, gen_salt('bf')), false)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_operator(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_operator(text, text) TO service_role;