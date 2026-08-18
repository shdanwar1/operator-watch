ALTER TABLE public.push_notification_deliveries
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS devices_sent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS devices_failed integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.claim_push_delivery(
  p_operator_id uuid,
  p_key text,
  p_type text,
  p_scheduled_at timestamptz,
  p_expires_at timestamptz,
  p_max_attempts integer DEFAULT 5,
  p_stale_after interval DEFAULT interval '5 minutes'
)
RETURNS TABLE(id uuid, attempts integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.push_notification_deliveries AS d
    (operator_id, notification_key, notification_type, scheduled_at, expires_at,
     status, attempts, last_attempt_at, locked_at)
  VALUES
    (p_operator_id, p_key, p_type, p_scheduled_at, p_expires_at,
     'sending', 1, now(), now())
  ON CONFLICT (operator_id, notification_key) DO UPDATE
    SET status = 'sending',
        attempts = d.attempts + 1,
        last_attempt_at = now(),
        locked_at = now(),
        expires_at = COALESCE(d.expires_at, EXCLUDED.expires_at)
    WHERE d.attempts < p_max_attempts
      AND COALESCE(d.expires_at, EXCLUDED.expires_at) > now()
      AND (
        d.status = 'failed'
        OR (d.status = 'sending' AND COALESCE(d.locked_at, d.created_at) < now() - p_stale_after)
      )
  RETURNING d.id, d.attempts;
$$;

REVOKE ALL ON FUNCTION public.claim_push_delivery(uuid, text, text, timestamptz, timestamptz, integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_delivery(uuid, text, text, timestamptz, timestamptz, integer, interval) TO service_role;