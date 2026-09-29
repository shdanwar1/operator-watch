ALTER TABLE public.scheduled_shifts ADD COLUMN IF NOT EXISTS time_to_leave_attempted_at timestamptz;

-- Invalidation also clears the retry marker, so a changed shift/home/studio retries promptly.
CREATE OR REPLACE FUNCTION public.invalidate_shift_time_to_leave()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if new.specific_date is distinct from old.specific_date
     or new.start_time is distinct from old.start_time
     or lower(coalesce(new.assigned_operator,'')) is distinct from lower(coalesce(old.assigned_operator,''))
     or new.status is distinct from old.status then
    new.time_to_leave := null;
    new.time_to_leave_calculated_at := null;
    new.time_to_leave_attempted_at := null;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.invalidate_operator_time_to_leave()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if new.home_lat is distinct from old.home_lat or new.home_lng is distinct from old.home_lng then
    update public.scheduled_shifts
       set time_to_leave = null, time_to_leave_calculated_at = null, time_to_leave_attempted_at = null
     where lower(assigned_operator) = lower(new.username)
       and (time_to_leave is not null or time_to_leave_attempted_at is not null)
       and specific_date >= ((now() at time zone 'Europe/Berlin')::date - 1)
       and ((specific_date + start_time) at time zone 'Europe/Berlin') > now();
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.invalidate_studio_time_to_leave()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if new.key = 'studio' and (tg_op = 'INSERT'
     or new.value->'lat' is distinct from old.value->'lat'
     or new.value->'lng' is distinct from old.value->'lng') then
    update public.scheduled_shifts
       set time_to_leave = null, time_to_leave_calculated_at = null, time_to_leave_attempted_at = null
     where (time_to_leave is not null or time_to_leave_attempted_at is not null)
       and specific_date >= ((now() at time zone 'Europe/Berlin')::date - 1)
       and ((specific_date + start_time) at time zone 'Europe/Berlin') > now();
  end if;
  return new;
end $function$;

-- True when a delivery key still needs work (missing, failed, or stale "sending").
CREATE OR REPLACE FUNCTION public.push_key_open(p_operator_id uuid, p_key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select not exists (
    select 1 from public.push_notification_deliveries d
    where d.operator_id = p_operator_id and d.notification_key = p_key
      and (d.status in ('sent','partial','no_subscription','cancelled','expired')
           or d.attempts >= 5
           or (d.expires_at is not null and d.expires_at <= now())
           or (d.status = 'sending' and coalesce(d.locked_at, d.created_at) >= now() - interval '5 minutes'))
  );
$function$;

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
      or (k.time_to_leave is null
        and k.start_at between now() + interval '2 hours' and now() + interval '2 hours 20 minutes'
        and (k.time_to_leave_attempted_at is null or k.time_to_leave_attempted_at < now() - interval '10 minutes'))
      or (k.specific_date = (now() at time zone 'Europe/Berlin')::date
        and (now() at time zone 'Europe/Berlin')::time between time '08:59' and time '09:16'
        and k.created_at <= ((k.specific_date + time '09:00') at time zone 'Europe/Berlin')
        and public.push_key_open(k.op_id, 'daily_shift_reminder:' || k.op_id || ':' || to_char(k.specific_date, 'YYYY-MM-DD')))
  );
$function$;

-- Daily maintenance (replaces per-minute expiry sweep + keeps 7-day retention).
CREATE OR REPLACE FUNCTION public.push_daily_maintenance()
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  update public.push_notification_deliveries set status = 'expired', locked_at = null
   where status in ('pending','failed') and expires_at < now();
  delete from public.push_notification_deliveries where created_at < now() - interval '7 days';
$function$;

REVOKE ALL ON FUNCTION public.push_key_open(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_daily_maintenance() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_key_open(uuid, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.push_daily_maintenance() TO service_role, postgres;
revoke all on function public.push_dispatch_due() from public, anon, authenticated;
grant execute on function public.push_dispatch_due() to service_role, postgres;