
-- Add pin_hash for PIN-based auth
ALTER TABLE public.operators ADD COLUMN IF NOT EXISTS pin_hash text;

-- RPC to verify a PIN and return operator id (service_role only)
CREATE OR REPLACE FUNCTION public.verify_operator_pin(p_username text, p_pin text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE rec RECORD;
BEGIN
  SELECT id, pin_hash INTO rec FROM public.operators WHERE lower(username) = lower(p_username);
  IF rec IS NULL OR rec.pin_hash IS NULL THEN RETURN NULL; END IF;
  IF rec.pin_hash = crypt(p_pin, rec.pin_hash) THEN RETURN rec.id; END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_operator_pin(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_operator_pin(text, text) TO service_role;

-- Set PINs for existing accounts
UPDATE public.operators SET pin_hash = extensions.crypt('2026', extensions.gen_salt('bf'))
  WHERE lower(username) = 'admin';
UPDATE public.operators SET pin_hash = extensions.crypt('2217', extensions.gen_salt('bf'))
  WHERE lower(username) = 'shad';

-- Create Alex and Max as empty operators. password_hash/magic_word_hash are NOT NULL,
-- so store unusable random hashes (login is PIN-only now).
INSERT INTO public.operators (username, password_hash, magic_word_hash, pin_hash, is_admin)
SELECT 'Alex',
       extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')),
       extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')),
       extensions.crypt('1125', extensions.gen_salt('bf')),
       false
WHERE NOT EXISTS (SELECT 1 FROM public.operators WHERE lower(username) = 'alex');

INSERT INTO public.operators (username, password_hash, magic_word_hash, pin_hash, is_admin)
SELECT 'Max',
       extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')),
       extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')),
       extensions.crypt('1412', extensions.gen_salt('bf')),
       false
WHERE NOT EXISTS (SELECT 1 FROM public.operators WHERE lower(username) = 'max');

-- Public-safe list of operators for the user-selection screen (no hashes, no mobile)
CREATE OR REPLACE FUNCTION public.list_operators_for_selection()
RETURNS TABLE(id uuid, username text, is_admin boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, username, is_admin FROM public.operators ORDER BY is_admin DESC, username;
$$;

REVOKE ALL ON FUNCTION public.list_operators_for_selection() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_operators_for_selection() TO service_role;

-- Admin can set a user's PIN
CREATE OR REPLACE FUNCTION public.set_operator_pin(p_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.operators
     SET pin_hash = crypt(p_pin, gen_salt('bf')),
         updated_at = now()
   WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_operator_pin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_operator_pin(uuid, text) TO service_role;
