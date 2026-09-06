CREATE TABLE public.deleted_shift_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  operator_name text NOT NULL,
  external_event_id text NOT NULL,
  specific_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX deleted_shift_events_key
  ON public.deleted_shift_events (lower(operator_name), external_event_id);

GRANT ALL ON public.deleted_shift_events TO service_role;

ALTER TABLE public.deleted_shift_events ENABLE ROW LEVEL SECURITY;