
-- Verify operator password. Returns operator id if valid, NULL otherwise.
CREATE OR REPLACE FUNCTION public.verify_operator_password(p_username TEXT, p_password TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  rec RECORD;
BEGIN
  SELECT id, password_hash INTO rec FROM public.operators WHERE username = p_username;
  IF rec IS NULL THEN RETURN NULL; END IF;
  IF rec.password_hash = crypt(p_password, rec.password_hash) THEN
    RETURN rec.id;
  END IF;
  RETURN NULL;
END;
$$;

-- Verify magic word. Returns operator id if valid, NULL otherwise.
CREATE OR REPLACE FUNCTION public.verify_operator_magic(p_username TEXT, p_magic TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  rec RECORD;
BEGIN
  SELECT id, magic_word_hash INTO rec FROM public.operators WHERE username = p_username;
  IF rec IS NULL THEN RETURN NULL; END IF;
  IF rec.magic_word_hash = crypt(p_magic, rec.magic_word_hash) THEN
    RETURN rec.id;
  END IF;
  RETURN NULL;
END;
$$;

-- Create an operator with plain values; hashes internally.
CREATE OR REPLACE FUNCTION public.create_operator(
  p_username TEXT,
  p_password TEXT,
  p_mobile TEXT,
  p_magic TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO public.operators (username, password_hash, mobile, magic_word_hash)
  VALUES (p_username, crypt(p_password, gen_salt('bf')), p_mobile, crypt(p_magic, gen_salt('bf')))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- Update operator fields. Any non-null value is applied; password/magic get re-hashed.
CREATE OR REPLACE FUNCTION public.update_operator(
  p_id UUID,
  p_username TEXT,
  p_password TEXT,
  p_mobile TEXT,
  p_magic TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.operators SET
    username = COALESCE(p_username, username),
    password_hash = CASE WHEN p_password IS NOT NULL THEN crypt(p_password, gen_salt('bf')) ELSE password_hash END,
    mobile = CASE WHEN p_mobile IS NOT NULL THEN NULLIF(p_mobile, '') ELSE mobile END,
    magic_word_hash = CASE WHEN p_magic IS NOT NULL THEN crypt(p_magic, gen_salt('bf')) ELSE magic_word_hash END
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_operator_password(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_operator_magic(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_operator(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_operator(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_operator_password(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_operator_magic(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_operator(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_operator(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
