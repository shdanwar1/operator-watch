alter table public.operators
  add column if not exists commute_minutes integer,
  add column if not exists commute_route_key text,
  add column if not exists commute_calculated_at timestamptz,
  add column if not exists leave_shift_start timestamptz,
  add column if not exists leave_at timestamptz;

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
      and (
        ((s.specific_date + s.start_time) at time zone 'Europe/Berlin')
          between now() - interval '20 minutes' and now() + interval '20 minutes'
        or ((s.specific_date + s.start_time) at time zone 'Europe/Berlin')
          between now() + interval '2 hours' and now() + interval '2 hours 20 minutes'
      )
  ) or exists (
    select 1 from public.operators o
    where o.leave_at is not null
      and o.leave_at - interval '15 minutes' between now() - interval '20 minutes' and now() + interval '20 minutes'
  );
$$;

revoke all on function public.push_dispatch_due() from public;
revoke all on function public.push_dispatch_due() from anon, authenticated;
grant execute on function public.push_dispatch_due() to service_role, postgres;