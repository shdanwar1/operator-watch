create or replace function public.push_dispatch_due()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.scheduled_shifts s
    where s.assigned_operator is not null
      and s.status is distinct from 'cancelled'
      and s.specific_date between ((now() at time zone 'Europe/Berlin')::date - 1)
                              and ((now() at time zone 'Europe/Berlin')::date + 1)
      and ((s.specific_date + s.start_time) at time zone 'Europe/Berlin')
            between now() - interval '20 minutes'
                and now() + interval '20 minutes'
  );
$$;

revoke all on function public.push_dispatch_due() from public;
revoke all on function public.push_dispatch_due() from anon, authenticated;
grant execute on function public.push_dispatch_due() to service_role, postgres;

drop table if exists public.operator_travel_plans;