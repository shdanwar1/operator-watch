create or replace function public.push_dispatch_due()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.scheduled_shifts s
    where s.assigned_operator is not null
      and s.status is distinct from 'cancelled'
      and s.specific_date between ((now() at time zone 'Europe/Berlin')::date - 1)
                              and ((now() at time zone 'Europe/Berlin')::date + 1)
      and (
        ((s.specific_date + s.start_time) at time zone 'Europe/Berlin')
          between now() - interval '20 minutes' and now() + interval '20 minutes'
        or (s.time_to_leave is null
            and ((s.specific_date + s.start_time) at time zone 'Europe/Berlin')
              between now() + interval '2 hours' and now() + interval '2 hours 20 minutes')
        or (s.time_to_leave is not null
            and s.time_to_leave - interval '15 minutes'
              between now() - interval '20 minutes' and now() + interval '20 minutes')
        or (s.specific_date = (now() at time zone 'Europe/Berlin')::date
            and (now() at time zone 'Europe/Berlin')::time between time '08:59' and time '09:16')
      )
  );
$function$;
revoke all on function public.push_dispatch_due() from public, anon, authenticated;
grant execute on function public.push_dispatch_due() to service_role, postgres;