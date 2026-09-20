create or replace function public.apply_checklist_item(p_items jsonb, p_item_id text, p_patch jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(
    (select jsonb_agg(case when e->>'id' = p_item_id then e || p_patch else e end order by ord)
       from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord)),
    '[]'::jsonb)
$$;

create or replace function public.set_shift_checklist_item(
  p_shift_id uuid,
  p_operator text,
  p_section text,
  p_class_id text,
  p_item_id text,
  p_completed boolean,
  p_completed_at text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shifts%rowtype;
  v_patch jsonb;
  v_next jsonb;
begin
  select * into v_row from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'SHIFT_NOT_FOUND'; end if;
  if lower(btrim(v_row.operator_name)) is distinct from lower(btrim(p_operator)) then
    raise exception 'FORBIDDEN';
  end if;
  if v_row.check_out_at is not null then raise exception 'SHIFT_CLOSED'; end if;
  if v_row.checklists is null or jsonb_typeof(v_row.checklists::jsonb) <> 'object' then
    raise exception 'NO_SNAPSHOT';
  end if;

  v_patch := jsonb_build_object(
    'completed', to_jsonb(p_completed),
    'completedAt', case when p_completed then to_jsonb(p_completed_at) else 'null'::jsonb end);

  v_next := v_row.checklists::jsonb;

  if p_section = 'start' then
    v_next := jsonb_set(v_next, '{start,items}',
      public.apply_checklist_item(v_next#>'{start,items}', p_item_id, v_patch));
  elsif p_section = 'end' then
    v_next := jsonb_set(v_next, '{end,items}',
      public.apply_checklist_item(v_next#>'{end,items}', p_item_id, v_patch));
  elsif p_section = 'class' then
    v_next := jsonb_set(v_next, '{classes}', coalesce((
      select jsonb_agg(case when c->>'classId' = p_class_id
                            then jsonb_set(c, '{items}', public.apply_checklist_item(c->'items', p_item_id, v_patch))
                            else c end order by ord)
        from jsonb_array_elements(coalesce(v_next->'classes', '[]'::jsonb)) with ordinality as t(c, ord)
    ), '[]'::jsonb));
  else
    raise exception 'INVALID_SECTION';
  end if;

  update public.shifts set checklists = v_next where id = p_shift_id;
  return v_next;
end;
$$;

create or replace function public.update_shift_checklists_cas(
  p_shift_id uuid,
  p_expected jsonb,
  p_next jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shifts%rowtype;
begin
  select * into v_row from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'SHIFT_NOT_FOUND'; end if;
  if v_row.check_out_at is not null then raise exception 'SHIFT_CLOSED'; end if;
  if v_row.checklists::jsonb is distinct from p_expected then return null; end if;
  update public.shifts set checklists = p_next where id = p_shift_id;
  return p_next;
end;
$$;

revoke all on function public.apply_checklist_item(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.set_shift_checklist_item(uuid, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.update_shift_checklists_cas(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_checklist_item(jsonb, text, jsonb) to service_role, postgres;
grant execute on function public.set_shift_checklist_item(uuid, text, text, text, text, boolean, text) to service_role, postgres;
grant execute on function public.update_shift_checklists_cas(uuid, jsonb, jsonb) to service_role, postgres;