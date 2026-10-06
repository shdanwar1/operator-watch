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
    select distinct on (o.id) sh.time_to_leave, sh.time_to_leave_attempted_at
    from public.scheduled_shifts sh
    join public.operators o on lower(o.username) = lower(btrim(sh.assigned_operator)) and o.is_active
    where sh.status is distinct from 'cancelled'
      and sh.specific_date between ((now() at time zone 'Europe/Berlin')::date - 1)
                               and ((now() at time zone 'Europe/Berlin')::date + 14)
      and ((sh.specific_date + sh.start_time) at time zone 'Europe/Berlin') > now()
    order by o.id, ((sh.specific_date + sh.start_time) at time zone 'Europe/Berlin')
  )
  select exists (
    select 1 from k where
      (k.start_at - interval '15 minutes' between now() - interval '15 minutes' and now() + interval '1 minute'
        and public.push_key_open(k.op_id, 'start:' || k.id || '@' || k.iso))
      or (k.start_at between now() - interval '15 minutes' and now() + interval '1 minute'
        and public.push_key_open(k.op_id, 'checkin:' || k.id || '@' || k.iso))
      or (k.time_to_leave is not null
        and k.time_to_leave > now() and k.time_to_leave <= now() + interval '16 minutes'
        and public.push_key_open(k.op_id, 'leave:' || k.id || '@' || k.iso))
      or (k.specific_date = (now() at time zone 'Europe/Berlin')::date
        and (now() at time zone 'Europe/Berlin')::time between time '08:59' and time '09:16'
        and k.created_at <= ((k.specific_date + time '09:00') at time zone 'Europe/Berlin')
        and public.push_key_open(k.op_id, 'daily_shift_reminder:' || k.op_id || ':' || to_char(k.specific_date, 'YYYY-MM-DD')))
  ) or exists (
    select 1 from nxt where nxt.time_to_leave is null
      and (nxt.time_to_leave_attempted_at is null or nxt.time_to_leave_attempted_at < now() - interval '10 minutes')
  ) or exists (
    select 1
    from public.shifts f
    join public.scheduled_shifts sc on sc.id = f.scheduled_shift_id
    where f.check_out_at is null
      and ((sc.specific_date + sc.end_time
            + case when sc.end_time <= sc.start_time then interval '1 day' else interval '0' end)
           at time zone 'Europe/Berlin') <= now()
      and jsonb_typeof(f.checklists -> 'end' -> 'items') = 'array'
      and jsonb_array_length(f.checklists -> 'end' -> 'items') > 0
      and not exists (
        select 1 from jsonb_array_elements(f.checklists -> 'end' -> 'items') i
        where coalesce((i ->> 'completed')::boolean, false) = false
      )
  );
$function$;