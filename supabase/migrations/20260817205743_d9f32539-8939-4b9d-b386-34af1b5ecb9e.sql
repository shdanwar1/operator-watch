CREATE OR REPLACE FUNCTION public.rename_operator(p_id uuid, p_username text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_name text;
  new_name text := btrim(p_username);
BEGIN
  IF new_name = '' OR new_name IS NULL THEN
    RAISE EXCEPTION 'Username is required';
  END IF;

  SELECT username INTO old_name FROM public.operators WHERE id = p_id;
  IF old_name IS NULL THEN
    RAISE EXCEPTION 'Operator not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.operators
    WHERE lower(username) = lower(new_name) AND id <> p_id
  ) THEN
    RAISE EXCEPTION 'This username is already in use.';
  END IF;

  IF old_name = new_name THEN
    RETURN;
  END IF;

  UPDATE public.operators SET username = new_name, updated_at = now() WHERE id = p_id;

  -- Historic data is keyed by name, so it has to travel with the rename.
  UPDATE public.shifts SET operator_name = new_name WHERE lower(operator_name) = lower(old_name);
  UPDATE public.scheduled_shifts SET assigned_operator = new_name WHERE lower(assigned_operator) = lower(old_name);
  UPDATE public.calendar_classes SET operator = new_name WHERE lower(operator) = lower(old_name);
END;
$function$;

REVOKE ALL ON FUNCTION public.rename_operator(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_operator(uuid, text) TO service_role;

-- Existing rename paths must go through the cascading function.
CREATE OR REPLACE FUNCTION public.set_operator_username(p_id uuid, p_username text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.rename_operator(p_id, p_username);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_operator(p_id uuid, p_username text DEFAULT NULL::text, p_pin text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_username IS NOT NULL AND btrim(p_username) <> '' THEN
    PERFORM public.rename_operator(p_id, p_username);
  END IF;

  IF p_pin IS NOT NULL AND p_pin <> '' THEN
    UPDATE public.operators
       SET pin_hash = crypt(p_pin, gen_salt('bf')), updated_at = now()
     WHERE id = p_id;
  END IF;
END;
$function$;