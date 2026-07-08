
CREATE OR REPLACE FUNCTION public.find_operator_by_magic(p_magic TEXT)
RETURNS TABLE(id UUID, username TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.username
  FROM public.operators o
  WHERE o.magic_word_hash = crypt(p_magic, o.magic_word_hash)
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.find_operator_by_magic(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_operator_by_magic(TEXT) TO service_role;
