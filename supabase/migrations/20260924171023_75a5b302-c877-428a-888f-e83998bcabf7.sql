-- lovable-cron-fallback-reviewed: existing per-minute reminder dispatcher; only the auth header changes, cadence unchanged
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.cron_secret (id int primary key default 1 check (id = 1), secret text not null);
insert into private.cron_secret (secret) values (encode(extensions.gen_random_bytes(32), 'hex')) on conflict (id) do nothing;
revoke all on private.cron_secret from public, anon, authenticated;

create or replace function public.verify_cron_secret(_provided text)
returns boolean language sql stable security definer set search_path = private, public as $$
  select exists (select 1 from private.cron_secret where secret = _provided and length(_provided) > 0)
$$;
revoke all on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

select cron.unschedule('push-dispatch-every-minute');
select cron.schedule('push-dispatch-every-minute', '* * * * *', $cron$
  select net.http_post(
    url := 'https://project--a5a2a5ad-bdfa-419f-86a1-295667413520.lovable.app/api/public/hooks/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from private.cron_secret where id = 1)),
    body := '{}'::jsonb
  ) as request_id
  from (select 1) t
  where coalesce(public.push_dispatch_due(), true);
$cron$);