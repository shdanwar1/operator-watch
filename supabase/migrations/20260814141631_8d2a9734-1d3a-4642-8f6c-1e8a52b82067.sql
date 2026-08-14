CREATE OR REPLACE FUNCTION public.verify_site_password(p_pw text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE h text;
BEGIN
  SELECT value->>'hash' INTO h FROM public.app_settings WHERE key = 'site_password';
  IF h IS NULL THEN
    RETURN p_pw = 'dancemasterclass';
  END IF;
  RETURN h = crypt(p_pw, h);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_site_password(p_pw text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF p_pw IS NULL OR length(btrim(p_pw)) < 6 THEN
    RAISE EXCEPTION 'Site password must be at least 6 characters';
  END IF;
  INSERT INTO public.app_settings (key, value)
  VALUES ('site_password', jsonb_build_object('hash', crypt(p_pw, gen_salt('bf'))))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.verify_site_password(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_site_password(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_site_password(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_site_password(text) TO service_role;