
REVOKE ALL ON public.operators FROM PUBLIC;
REVOKE ALL ON public.operators FROM anon;
REVOKE ALL ON public.operators FROM authenticated;

ALTER TABLE public.operators FORCE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.verify_operator_password(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_operator_password(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.verify_operator_magic(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_operator_magic(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.find_operator_by_magic(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_operator_by_magic(text) TO service_role;

REVOKE ALL ON FUNCTION public.create_operator(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_operator(text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.update_operator(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_operator(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE VIEW public.operators_public AS
SELECT id, username, is_admin, created_at, updated_at
FROM public.operators;

REVOKE ALL ON public.operators_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.operators_public TO service_role;

CREATE OR REPLACE FUNCTION public.mask_mobile(p_mobile text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_mobile IS NULL OR length(p_mobile) < 3 THEN NULL
    ELSE repeat('•', greatest(length(p_mobile) - 2, 1)) || right(p_mobile, 2)
  END;
$$;

REVOKE ALL ON FUNCTION public.mask_mobile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mask_mobile(text) TO service_role, anon, authenticated;
