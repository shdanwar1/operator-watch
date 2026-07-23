
-- Allow magic word to be unset so incomplete operators are truly incomplete.
ALTER TABLE public.operators ALTER COLUMN magic_word_hash DROP NOT NULL;

-- Clear placeholder magic words on operators that never set one themselves.
-- Shad is the only fully configured operator; everyone else starts empty.
UPDATE public.operators
   SET magic_word_hash = NULL
 WHERE lower(username) <> 'shad'
   AND is_admin = false;

-- Admin: create a new operator with only username + PIN. Everything else is left NULL
-- so the operator must complete their own profile on first login.
CREATE OR REPLACE FUNCTION public.admin_create_operator(p_username text, p_pin text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
  INSERT INTO public.operators (username, pin_hash, magic_word_hash, is_admin)
  VALUES (p_username, crypt(p_pin, gen_salt('bf')), NULL, false)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
