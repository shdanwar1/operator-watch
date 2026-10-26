ALTER TABLE public.dmc_timetable_slots ADD COLUMN active_until date;
COMMENT ON COLUMN public.dmc_timetable_slots.active_until IS 'Inclusive Berlin date cutoff, preserved across source refreshes.';
CREATE TABLE public.rotation_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 valid_from timestamptz NOT NULL,
 valid_until timestamptz NOT NULL,
 bucket text,
 weekday smallint,
 start_from time,
 start_to time,
 operator text NOT NULL,
 note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT rotation_adjustment_dates CHECK (valid_until > valid_from),
 CONSTRAINT rotation_adjustment_bucket CHECK (bucket IS NULL OR bucket IN ('day','night','weekend')),
 CONSTRAINT rotation_adjustment_weekday CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
 CONSTRAINT rotation_adjustment_window CHECK (start_from IS NULL OR start_to IS NULL OR start_to > start_from)
);
GRANT ALL ON public.rotation_adjustments TO service_role;
ALTER TABLE public.rotation_adjustments ENABLE ROW LEVEL SECURITY;
CREATE INDEX rotation_adjustments_validity_idx ON public.rotation_adjustments(valid_from, valid_until);