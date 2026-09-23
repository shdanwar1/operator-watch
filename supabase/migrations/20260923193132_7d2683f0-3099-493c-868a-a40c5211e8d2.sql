ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS device_type text,
  ADD COLUMN IF NOT EXISTS browser text,
  ADD COLUMN IF NOT EXISTS device_label text;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_device_type_check
  CHECK (device_type IS NULL OR device_type IN ('mobile','tablet'));