CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  platform text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE INDEX push_subscriptions_operator_idx ON public.push_subscriptions (operator_id) WHERE disabled_at IS NULL;

CREATE TABLE public.operator_travel_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  shift_start_at timestamptz NOT NULL,
  shift_end_at timestamptz,
  departure_at timestamptz NOT NULL,
  arrival_at timestamptz NOT NULL,
  travel_minutes integer NOT NULL,
  transfers integer NOT NULL DEFAULT 0,
  route_label text,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  algorithm_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, shift_start_at, algorithm_version)
);
GRANT ALL ON public.operator_travel_plans TO service_role;
ALTER TABLE public.operator_travel_plans ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_operator_travel_plans_updated_at
  BEFORE UPDATE ON public.operator_travel_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.push_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  notification_key text NOT NULL,
  notification_type text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, notification_key)
);
GRANT ALL ON public.push_notification_deliveries TO service_role;
ALTER TABLE public.push_notification_deliveries ENABLE ROW LEVEL SECURITY;
CREATE INDEX push_notification_deliveries_created_idx ON public.push_notification_deliveries (created_at);