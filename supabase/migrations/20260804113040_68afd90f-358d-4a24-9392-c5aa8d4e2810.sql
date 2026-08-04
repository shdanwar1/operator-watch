-- One-time (idempotent) repair of overnight shifts split at midnight.

DO $$
DECLARE
  pair RECORD;
  merged INT := 1;
BEGIN
  WHILE merged > 0 LOOP
    merged := 0;
    FOR pair IN
      SELECT a.id AS keep_id, b.id AS drop_id, b.end_time AS new_end
      FROM public.scheduled_shifts a
      JOIN public.scheduled_shifts b
        ON b.specific_date = a.specific_date + 1
       AND coalesce(b.assigned_operator, '') = coalesce(a.assigned_operator, '')
      WHERE a.end_time > a.start_time                     -- a not already overnight
        AND b.end_time > b.start_time                     -- b not already overnight
        AND a.end_time >= TIME '22:00'
        AND b.start_time <= TIME '02:00'
        AND (EXTRACT(EPOCH FROM (TIME '23:59:59' - a.end_time))
             + EXTRACT(EPOCH FROM b.start_time)) <= 3600  -- gap <= 60 min
    LOOP
      UPDATE public.calendar_classes SET scheduled_shift_id = pair.keep_id
        WHERE scheduled_shift_id = pair.drop_id;
      UPDATE public.shifts SET scheduled_shift_id = pair.keep_id
        WHERE scheduled_shift_id = pair.drop_id;
      UPDATE public.scheduled_shifts SET end_time = pair.new_end WHERE id = pair.keep_id;
      DELETE FROM public.scheduled_shifts WHERE id = pair.drop_id;
      merged := merged + 1;
    END LOOP;
  END LOOP;
END $$;

-- Refresh class-count labels on merged shifts.
UPDATE public.scheduled_shifts s
SET label = CASE WHEN c.n = 1 THEN '1 class' ELSE c.n || ' classes' END
FROM (
  SELECT scheduled_shift_id AS id, count(*) AS n
  FROM public.calendar_classes
  WHERE scheduled_shift_id IS NOT NULL
  GROUP BY scheduled_shift_id
) c
WHERE s.id = c.id
  AND s.end_time < s.start_time
  AND s.label IS DISTINCT FROM (CASE WHEN c.n = 1 THEN '1 class' ELSE c.n || ' classes' END);

-- Merge attendance records split at midnight (same operator, gap <= 60 min).
DO $$
DECLARE
  pair RECORD;
  merged INT := 1;
BEGIN
  WHILE merged > 0 LOOP
    merged := 0;
    FOR pair IN
      SELECT a.id AS keep_id, b.id AS drop_id, b.check_out_at AS new_out,
             coalesce(a.live_streams_count,0) + coalesce(b.live_streams_count,0) AS streams,
             (coalesce(a.classes,'[]'::jsonb) || coalesce(b.classes,'[]'::jsonb)) AS classes,
             nullif(concat_ws(E'\n', nullif(a.notes,''), nullif(b.notes,'')), '') AS notes
      FROM public.shifts a
      JOIN public.shifts b
        ON b.operator_name = a.operator_name
       AND b.check_in_at >= a.check_out_at
       AND b.check_in_at - a.check_out_at <= INTERVAL '60 minutes'
      WHERE a.check_out_at IS NOT NULL
        AND b.check_out_at IS NOT NULL
        AND a.id <> b.id
        AND (a.check_out_at AT TIME ZONE 'Europe/Berlin')::date
            <> (b.check_out_at AT TIME ZONE 'Europe/Berlin')::date
        AND (a.check_in_at AT TIME ZONE 'Europe/Berlin')::date
            <> (b.check_out_at AT TIME ZONE 'Europe/Berlin')::date
    LOOP
      UPDATE public.shifts
      SET check_out_at = pair.new_out,
          live_streams_count = pair.streams,
          classes = pair.classes,
          notes = pair.notes
      WHERE id = pair.keep_id;
      DELETE FROM public.shifts WHERE id = pair.drop_id;
      merged := merged + 1;
    END LOOP;
  END LOOP;
END $$;