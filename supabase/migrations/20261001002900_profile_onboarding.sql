-- First sign-in profile. Additive.
--   * profiles gains how the person takes part (interests), an optional location, and onboarded_at (null until they finish the step).
--   * The app sends a signed-in person with onboarded_at null to /welcome before anything else.
--   * Profiles stay private to their owner (existing policies). The name is what organizers and captains see on requests.
--   * Existing accounts that already have a name are marked done, so nobody is sent back through it.

alter table public.profiles
  add column interests text[] not null default '{}' check (interests <@ array['fighter','captain','organizer','volunteer','fan']::text[]),
  add column city text check (city is null or char_length(city) <= 80),
  add column region text check (region is null or char_length(region) <= 80),
  add column country text check (country is null or char_length(country) <= 80),
  add column onboarded_at timestamptz;

update public.profiles set onboarded_at = now() where onboarded_at is null and btrim(display_name) <> '';

create or replace function public.complete_my_profile(p_name text, p_interests text[], p_city text default null, p_region text default null, p_country text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'your name must be 2 to 80 characters' using errcode = '22023'; end if;
  if p_interests is null or cardinality(p_interests) = 0 then raise exception 'choose at least one way you take part' using errcode = '22023'; end if;
  if not (p_interests <@ array['fighter','captain','organizer','volunteer','fan']::text[]) then raise exception 'unknown choice' using errcode = '22023'; end if;
  if char_length(coalesce(p_city, '')) > 80 or char_length(coalesce(p_region, '')) > 80 or char_length(coalesce(p_country, '')) > 80 then
    raise exception 'city, province and country are at most 80 characters' using errcode = '22023'; end if;
  insert into public.profiles (id, display_name, interests, city, region, country, onboarded_at)
  values (auth.uid(), v_name, (select array_agg(distinct x) from unnest(p_interests) x), nullif(btrim(p_city), ''), nullif(btrim(p_region), ''), nullif(btrim(p_country), ''), now())
  on conflict (id) do update set display_name = excluded.display_name, interests = excluded.interests, city = excluded.city, region = excluded.region,
    country = excluded.country, onboarded_at = coalesce(public.profiles.onboarded_at, now());
end $$;
revoke execute on function public.complete_my_profile(text, text[], text, text, text) from public, anon;
grant execute on function public.complete_my_profile(text, text[], text, text, text) to authenticated;
