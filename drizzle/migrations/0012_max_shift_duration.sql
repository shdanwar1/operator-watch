ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS max_checkout_at timestamptz;

CREATE OR REPLACE FUNCTION public.shift_max_checkout_at(p_check_in timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  select case
    when ((p_check_in + interval '12 hours') at time zone 'Europe/Berlin')::time >= time '03:00'
     and ((p_check_in + interval '12 hours') at time zone 'Europe/Berlin')::time < time '05:00'
    then greatest(p_check_in,
      ((((p_check_in + interval '12 hours') at time zone 'Europe/Berlin')::date + time '02:59') at time zone 'Europe/Berlin'))
    else p_check_in + interval '12 hours'
  end
$$;

CREATE OR REPLACE FUNCTION public.set_shift_max_checkout_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if tg_op = 'INSERT' or new.check_in_at is distinct from old.check_in_at then
    new.max_checkout_at := public.shift_max_checkout_at(new.check_in_at);
  end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS shifts_set_max_checkout_at ON public.shifts;
CREATE TRIGGER shifts_set_max_checkout_at BEFORE INSERT OR UPDATE OF check_in_at ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.set_shift_max_checkout_at();

UPDATE public.shifts SET max_checkout_at = public.shift_max_checkout_at(check_in_at) WHERE max_checkout_at IS NULL;

CREATE INDEX IF NOT EXISTS shifts_open_max_checkout_idx ON public.shifts (max_checkout_at) WHERE check_out_at IS NULL;

CREATE OR REPLACE FUNCTION public.push_dispatch_due()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with s as (
    select sh.id, sh.time_to_leave, sh.time_to_leave_attempted_at, sh.created_at, sh.specific_date,
           o.id as op_id,
           ((sh.specific_date + sh.start_time) at time zone 'Europe/Berlin') as start_at
    from public.scheduled_shifts sh
    join public.operators o on lower(o.username) = lower(btrim(sh.assigned_operator)) and o.is_active
    where sh.status is distinct from 'cancelled'
      and sh.specific_date between ((now() at time zone 'Europe/Berlin')::date - 1)
                               and ((now() at time zone 'Europe/Berlin')::date + 1)
  ), k as (
    select s.*, to_char(s.start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as iso from s
  ), nxt as (
    select distinct on (op_id) * from k where start_at > now() order by op_id, start_at
  )
  select exists (
    select 1 from k where
      (coalesce(k.time_to_leave, k.start_at) - interval '60 minutes' between now() - interval '15 minutes' and now() + interval '1 minute'
        and public.push_key_open(k.op_id, 'hour:' || k.id || '@' || k.iso))
      or (k.start_at between now() - interval '15 minutes' and now() + interval '1 minute'
        and public.push_key_open(k.op_id, 'checkin:' || k.id || '@' || k.iso))
      or (k.time_to_leave is not null and k.time_to_leave < k.start_at
        and k.time_to_leave - interval '10 minutes' between now() - interval '15 minutes' and now() + interval '1 minute'
        and public.push_key_open(k.op_id, 'leave:' || k.id || '@' || k.iso))
  ) or exists (
    select 1 from nxt where nxt.time_to_leave is null
      and nxt.start_at <= now() + interval '24 hours'
      and (nxt.time_to_leave_attempted_at is null or nxt.time_to_leave_attempted_at < now() - interval '10 minutes')
  ) or exists (
    select 1
    from public.shifts f
    join public.scheduled_shifts sh on sh.id = f.scheduled_shift_id
    where f.check_out_at is null
      and f.auto_checkout_at_end = true
      and sh.status is distinct from 'cancelled'
      and sh.specific_date between ((now() at time zone 'Europe/Berlin')::date - 2)
                               and ((now() at time zone 'Europe/Berlin')::date)
      and (((sh.specific_date
             + case when sh.end_time <= sh.start_time then 1 else 0 end)
             + sh.end_time) at time zone 'Europe/Berlin')
          between now() - interval '60 minutes' and now()
  ) or exists (
    select 1 from public.shifts f
    where f.check_out_at is null and f.max_checkout_at <= now() + interval '1 minute'
  );
$function$;