
-- Case-insensitive username lookups (fixes credentials becoming invalid after normalization changes)
CREATE OR REPLACE FUNCTION public.verify_operator_password(p_username text, p_password text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  rec RECORD;
BEGIN
  SELECT id, password_hash INTO rec FROM public.operators WHERE lower(username) = lower(p_username);
  IF rec IS NULL THEN RETURN NULL; END IF;
  IF rec.password_hash = crypt(p_password, rec.password_hash) THEN
    RETURN rec.id;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_operator_magic(p_username text, p_magic text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  rec RECORD;
BEGIN
  SELECT id, magic_word_hash INTO rec FROM public.operators WHERE lower(username) = lower(p_username);
  IF rec IS NULL THEN RETURN NULL; END IF;
  IF rec.magic_word_hash = crypt(p_magic, rec.magic_word_hash) THEN
    RETURN rec.id;
  END IF;
  RETURN NULL;
END;
$function$;

-- Prevent duplicate usernames that differ only by case
CREATE UNIQUE INDEX IF NOT EXISTS operators_username_ci_key ON public.operators (lower(username));

-- Realtime for admin/operator live sync
ALTER TABLE public.shifts REPLICA IDENTITY FULL;
ALTER TABLE public.scheduled_shifts REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_shifts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
