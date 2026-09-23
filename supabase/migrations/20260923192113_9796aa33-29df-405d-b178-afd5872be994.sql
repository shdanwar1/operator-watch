alter table public.scheduled_shifts
  add column if not exists time_to_leave timestamptz,
  add column if not exists time_to_leave_calculated_at timestamptz;

-- A shift change that affects timing or assignment invalidates its Time to Leave.
create or replace function public.invalidate_shift_time_to_leave()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.specific_date is distinct from old.specific_date
     or new.start_time is distinct from old.start_time
     or lower(coalesce(new.assigned_operator,'')) is distinct from lower(coalesce(old.assigned_operator,''))
     or new.status is distinct from old.status then
    new.time_to_leave := null;
    new.time_to_leave_calculated_at := null;
  end if;
  return new;
end $$;

drop trigger if exists scheduled_shifts_invalidate_ttl on public.scheduled_shifts;
create trigger scheduled_shifts_invalidate_ttl
  before update on public.scheduled_shifts
  for each row execute function public.invalidate_shift_time_to_leave();

-- Home moved: clear that operator's future shifts.
create or replace function public.invalidate_operator_time_to_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.home_lat is distinct from old.home_lat or new.home_lng is distinct from old.home_lng then
    update public.scheduled_shifts
       set time_to_leave = null, time_to_leave_calculated_at = null
     where lower(assigned_operator) = lower(new.username)
       and time_to_leave is not null
       and specific_date >= ((now() at time zone 'Europe/Berlin')::date - 1)
       and ((specific_date + start_time) at time zone 'Europe/Berlin') > now();
  end if;
  return new;
end $$;

drop trigger if exists operators_invalidate_ttl on public.operators;
create trigger operators_invalidate_ttl
  after update on public.operators
  for each row execute function public.invalidate_operator_time_to_leave();

-- Studio moved: clear all future shifts.
create or replace function public.invalidate_studio_time_to_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.key = 'studio' and (tg_op = 'INSERT'
     or new.value->'lat' is distinct from old.value->'lat'
     or new.value->'lng' is distinct from old.value->'lng') then
    update public.scheduled_shifts
       set time_to_leave = null, time_to_leave_calculated_at = null
     where time_to_leave is not null
       and specific_date >= ((now() at time zone 'Europe/Berlin')::date - 1)
       and ((specific_date + start_time) at time zone 'Europe/Berlin') > now();
  end if;
  return new;
end $$;

drop trigger if exists app_settings_invalidate_ttl on public.app_settings;
create trigger app_settings_invalidate_ttl
  after insert or update on public.app_settings
  for each row execute function public.invalidate_studio_time_to_leave();

revoke all on function public.invalidate_operator_time_to_leave() from public, anon, authenticated;
revoke all on function public.invalidate_studio_time_to_leave() from public, anon, authenticated;

-- Remove the operator-level leave cache; the shift row is the source of truth.
alter table public.operators
  drop column if exists leave_shift_start,
  drop column if exists leave_at,
  drop column if exists commute_calculated_at;

create or replace function public.push_dispatch_due()
returns boolean language sql stable security definer set search_path = public as $$
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
      )
  );
$$;

revoke all on function public.push_dispatch_due() from public;
revoke all on function public.push_dispatch_due() from anon, authenticated;
grant execute on function public.push_dispatch_due() to service_role, postgres;