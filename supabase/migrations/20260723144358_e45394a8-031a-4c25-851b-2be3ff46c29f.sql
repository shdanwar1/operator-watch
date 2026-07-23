
DROP FUNCTION IF EXISTS public.create_operator(text, text, text, text);
DROP FUNCTION IF EXISTS public.update_operator(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.verify_operator_password(text, text);
DROP FUNCTION IF EXISTS public.mask_mobile(text);

ALTER TABLE public.operators DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.operators DROP COLUMN IF EXISTS mobile;

ALTER TABLE public.operators DROP CONSTRAINT IF EXISTS operators_username_key;
DROP INDEX IF EXISTS operators_username_ci_key;
CREATE UNIQUE INDEX operators_username_ci_key ON public.operators (lower(username));

CREATE OR REPLACE FUNCTION public.verify_operator_magic(p_username text, p_magic text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE rec RECORD;
BEGIN
  SELECT id, magic_word_hash INTO rec FROM public.operators
   WHERE lower(username) = lower(p_username);
  IF rec IS NULL THEN RETURN NULL; END IF;
  IF rec.magic_word_hash = crypt(p_magic, rec.magic_word_hash) THEN RETURN rec.id; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_operator(
  p_id uuid, p_username text DEFAULT NULL, p_pin text DEFAULT NULL, p_magic text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.operators SET
    username = COALESCE(NULLIF(p_username, ''), username),
    pin_hash = CASE WHEN p_pin IS NOT NULL AND p_pin <> '' THEN crypt(p_pin, gen_salt('bf')) ELSE pin_hash END,
    magic_word_hash = CASE WHEN p_magic IS NOT NULL AND p_magic <> '' THEN crypt(p_magic, gen_salt('bf')) ELSE magic_word_hash END,
    updated_at = now()
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_operator_magic(p_id uuid, p_magic text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.operators SET magic_word_hash = crypt(p_magic, gen_salt('bf')), updated_at = now()
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_operator_username(p_id uuid, p_username text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.operators SET username = p_username, updated_at = now() WHERE id = p_id;
END;
$$;
