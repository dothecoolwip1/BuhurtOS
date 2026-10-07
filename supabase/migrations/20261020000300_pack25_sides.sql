-- Pack 25.2: the sides of a fight carry the event's own names and colours (the flag colours of the day), chosen by anyone who runs the Lyst;
-- the counter phone names who is fighting on each Lyst and on each side.
--   1. private.event_sides(event): the two sides' names and colours, default Red #B42318 / Blue #2C4A8C, stored in event_lyst_settings.settings->'sides'.
--   2. public.set_event_sides(event, sides): organizer, head marshal, marshal, secretary (scorekeeper) or the platform owner changes them; audited.
--      The rest of the Lyst settings keep their head-marshal-or-organizer rule (set_lyst_settings is untouched; it merges, so the sides survive it).
--   3. counter_state: 'sides' (names and colours for the phone), and each entry of 'fields' carries 'now' (who is fighting there) so the Lyst
--      chooser and the side chooser can say who is who. lyst_state already returns the stored settings, so the Lyst reads settings.sides.
-- Additive: no table changes, no drops.

create or replace function private.event_sides(p_event uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'a', jsonb_build_object('name', 'Red', 'color', '#B42318') || coalesce((select s.settings -> 'sides' -> 'a' from public.event_lyst_settings s where s.event_id = p_event), '{}'::jsonb),
    'b', jsonb_build_object('name', 'Blue', 'color', '#2C4A8C') || coalesce((select s.settings -> 'sides' -> 'b' from public.event_lyst_settings s where s.event_id = p_event), '{}'::jsonb))
$$;
revoke execute on function private.event_sides(uuid) from public, anon, authenticated;

create or replace function public.set_event_sides(p_event uuid, p_sides jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_side text; v_in jsonb; v_name text; v_color text; v_clean jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not (private.can_score(p_event) or private.is_owner()) then raise exception 'only the event''s organizer, marshals or secretary can change the side colours' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_sides, 'null'::jsonb)) <> 'object' then raise exception 'send the sides as an object with a and b' using errcode = '22023'; end if;
  foreach v_side in array array['a', 'b'] loop
    v_in := p_sides -> v_side;
    if v_in is null then continue; end if;
    if jsonb_typeof(v_in) <> 'object' then raise exception 'side % needs a name and a colour', v_side using errcode = '22023'; end if;
    v_name := nullif(btrim(coalesce(v_in ->> 'name', '')), '');
    v_color := upper(btrim(coalesce(v_in ->> 'color', '')));
    if v_name is null or char_length(v_name) > 20 then raise exception 'a side name is 1 to 20 characters' using errcode = '22023'; end if;
    if v_color !~ '^#[0-9A-F]{6}$' then raise exception 'a side colour is a hex colour like #B42318' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object(v_side, jsonb_build_object('name', v_name, 'color', v_color));
  end loop;
  if v_clean = '{}'::jsonb then raise exception 'send at least one side' using errcode = '22023'; end if;
  insert into public.event_lyst_settings (event_id, settings, updated_at) values (p_event, jsonb_build_object('sides', v_clean), now())
  on conflict (event_id) do update set settings = public.event_lyst_settings.settings || jsonb_build_object('sides', coalesce(public.event_lyst_settings.settings -> 'sides', '{}'::jsonb) || v_clean), updated_at = now();
  perform private.audit(p_event, 'lyst.sides', p_event::text, v_clean);
  return private.event_sides(p_event);
end $$;
revoke execute on function public.set_event_sides(uuid, jsonb) from public, anon;
grant execute on function public.set_event_sides(uuid, jsonb) to authenticated;
comment on function public.set_event_sides(uuid, jsonb) is 'Pack 25.2: the two sides'' names and colours for an event (anyone who runs the Lyst, or the platform owner); shown on counter phones and the Lyst.';

create or replace function private.counter_state_for(p_sub uuid, p_touch boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_sid uuid; v_event uuid; v_label text; v_b public.counter_bindings; v_s public.lyst_counter_seats; v_m public.matches; v_cur public.lyst_rounds; v_t public.lyst_timer;
  v_e public.events; v_input text; v_comp text; v_match uuid; v_key text; v_side text; v_per integer; v_total integer; v_kind text; v_fields jsonb; v_opponent text;
begin
  select s.id, c.event_id, c.label into v_sid, v_event, v_label from public.event_sessions s join public.event_credentials c on c.id = s.credential_id
   where s.id = p_sub and s.ended_at is null and c.revoked_at is null and c.role = 'counter' and private.device_valid_at(c.id, clock_timestamp());
  if v_sid is not null then
    v_kind := 'device';
    if p_touch then update public.event_sessions set last_seen_at = clock_timestamp() where id = v_sid and (last_seen_at is null or last_seen_at < clock_timestamp() - interval '30 seconds'); end if;
    select * into v_b from public.counter_bindings where session_id = v_sid;
    select * into v_s from public.lyst_counter_seats where user_id = v_sid and status = 'active' order by requested_at desc limit 1;
    v_key := coalesce(v_s.field_key, v_b.field_key); v_side := coalesce(v_s.side, v_b.side);
  else
    v_kind := 'training';
    select * into v_s from public.lyst_counter_seats where user_id = p_sub and status = 'active' and role = 'learning' order by requested_at desc limit 1;
    if v_s.id is null then return jsonb_build_object('kind', v_kind, 'seat', null, 'server_now', clock_timestamp()); end if;
    v_event := v_s.event_id; v_key := v_s.field_key; v_side := v_s.side;
  end if;
  select * into v_e from public.events where id = v_event;
  select coalesce(jsonb_agg(jsonb_build_object('key', f.field_key, 'label', f.label, 'open', c.match_id is not null,
      'now', case when c.match_id is null then null else jsonb_build_object('a', private.lyst_side_name(c.entry_a), 'b', private.lyst_side_name(c.entry_b)) end) order by f.field_key collate "C"), '[]'::jsonb) into v_fields
    from private.event_field_keys(v_event) f left join lateral (select m.id as match_id, m.entry_a, m.entry_b from public.matches m where m.id = private.field_current_match(v_event, f.field_key)) c on true;
  v_match := case when v_key is not null then private.field_current_match(v_event, v_key) end;
  if v_s.id is not null and v_s.match_id is not null and v_s.match_id = v_match then
    select * into v_m from public.matches where id = v_match;
    select name into v_comp from public.competitions where id = v_m.competition_id;
    select counter_input into v_input from public.lyst_matches where match_id = v_match;
    select * into v_cur from public.lyst_rounds where match_id = v_match order by round_no desc limit 1;
    select * into v_t from public.lyst_timer where event_id = v_event and field_key = v_key and match_id = v_match;
    v_per := private.lyst_per_side(v_match);
    v_total := case when v_cur.match_id is null then 0 else private.lyst_seat_total(v_s.id, v_cur.round_no) end;
    v_opponent := private.lyst_side_name(case when v_side = 'a' then v_m.entry_b else v_m.entry_a end);
  end if;
  return jsonb_build_object(
    'kind', v_kind, 'session_id', v_sid, 'device_label', v_label,
    'event', jsonb_build_object('id', v_e.id, 'slug', v_e.slug, 'name', v_e.name, 'closed', v_e.closed_at is not null),
    'fields', v_fields,
    'binding', case when v_kind = 'device' then jsonb_build_object('field_key', v_b.field_key, 'side', v_b.side, 'operator', v_b.operator_name) else jsonb_build_object('field_key', v_s.field_key, 'side', v_s.side, 'operator', v_s.display_name) end,
    'field_label', (select f.label from private.event_field_keys(v_event) f where f.field_key = v_key),
    'seat', case when v_s.id is null then null else jsonb_build_object('id', v_s.id, 'status', case when v_s.expires_at < now() then 'expired' else v_s.status end, 'side', v_s.side, 'role', v_s.role, 'field_key', v_s.field_key, 'operator', v_s.display_name, 'match_id', v_s.match_id) end,
    'waiting', v_s.id is not null and (v_s.match_id is null or v_s.match_id is distinct from v_match),
    'match_id', case when v_m.id is null then null else v_m.id end, 'competition', v_comp, 'round_label', v_m.round_label, 'final', coalesce(v_m.queue_state = 'final', false),
    'fighter', case when v_m.id is null then null else private.lyst_side_name(case when v_side = 'a' then v_m.entry_a else v_m.entry_b end) end,
    'opponent', v_opponent,
    'counter_input', coalesce(v_input, 'simple'), 'per_side', v_per, 'standing', case when v_input = 'standing' then greatest(0, v_per - coalesce(v_total, 0)) end,
    'round', case when v_cur.match_id is null then null else jsonb_build_object('no', v_cur.round_no, 'status', v_cur.status) end,
    'my_total', coalesce(v_total, 0),
    'submitted', case when v_cur.match_id is null then false else exists (select 1 from public.lyst_counter_rounds r where r.seat_id = v_s.id and r.match_id = v_match and r.round_no = v_cur.round_no) end,
    'can_count', v_s.id is not null and v_s.status = 'active' and v_s.expires_at >= now() and v_side is not null and v_m.id is not null and v_m.queue_state <> 'final' and v_cur.status = 'running',
    'timer', case when v_t.event_id is null then null else private.lyst_timer_json(v_t) end,
    'fights', case when v_key is null then null else private.field_fights(v_event, v_key) end,
    'sides', private.event_sides(v_event),
    'server_now', clock_timestamp());
end $$;
