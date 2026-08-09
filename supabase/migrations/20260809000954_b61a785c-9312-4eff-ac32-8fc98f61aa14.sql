CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.app_settings TO service_role;
REVOKE ALL ON public.app_settings FROM anon, authenticated;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER update_app_settings_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.app_settings (key, value) VALUES
  ('studio', '{"label":"Dance Masterclass Studio","lat":52.5263162,"lng":13.3229399}'::jsonb),
  ('checkout', '{"message":"Did you turn the security camera back ON?","enabled":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;