
ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS home_label TEXT,
  ADD COLUMN IF NOT EXISTS home_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS home_lng DOUBLE PRECISION;

UPDATE public.operators
SET home_label = 'Kaiserin-Augusta-Allee 10, 10553 Berlin',
    home_lat = 52.5263162,
    home_lng = 13.3229399
WHERE username = 'shad';

CREATE OR REPLACE FUNCTION public.set_operator_home(
  p_id UUID,
  p_label TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.operators
  SET home_label = p_label,
      home_lat = p_lat,
      home_lng = p_lng,
      updated_at = now()
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_operator_home(uuid, text, double precision, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_operator_home(uuid, text, double precision, double precision) TO service_role;
