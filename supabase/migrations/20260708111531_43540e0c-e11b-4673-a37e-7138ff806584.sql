
CREATE OR REPLACE FUNCTION public.mask_mobile(p_mobile text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_mobile IS NULL OR length(p_mobile) < 3 THEN NULL
    ELSE repeat('•', greatest(length(p_mobile) - 2, 1)) || right(p_mobile, 2)
  END;
$$;
