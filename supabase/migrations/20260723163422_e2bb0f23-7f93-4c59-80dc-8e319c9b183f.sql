
-- 1. Add is_active column
ALTER TABLE public.operators ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Update list_operators_for_selection to only return active operators
CREATE OR REPLACE FUNCTION public.list_operators_for_selection()
 RETURNS TABLE(id uuid, username text, is_admin boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, username, is_admin
  FROM public.operators
  WHERE is_active = true
  ORDER BY is_admin DESC, username;
$function$;

-- 3. verify_operator_pin: reject inactive operators
CREATE OR REPLACE FUNCTION public.verify_operator_pin(p_username text, p_pin text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE rec RECORD;
BEGIN
  SELECT id, pin_hash, is_active INTO rec
    FROM public.operators
   WHERE lower(username) = lower(p_username);
  IF rec IS NULL OR rec.pin_hash IS NULL OR rec.is_active = false THEN RETURN NULL; END IF;
  IF rec.pin_hash = crypt(p_pin, rec.pin_hash) THEN RETURN rec.id; END IF;
  RETURN NULL;
END;
$function$;

-- 4. RPC to set active/inactive
CREATE OR REPLACE FUNCTION public.admin_set_operator_active(p_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.operators
     SET is_active = p_active, updated_at = now()
   WHERE id = p_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_operator_active(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_operator_active(uuid, boolean) TO service_role;
