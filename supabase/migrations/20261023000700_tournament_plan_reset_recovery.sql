-- A deliberate draw reset invalidates the old build receipt. Preserve that
-- receipt and its generation; a byte-identical plan may then be built again.
alter table private.tournament_build_plans add column invalidated_at timestamptz;
alter table private.tournament_build_plans add column generation integer not null default 1;
create function private.invalidate_tournament_build_plan() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update private.tournament_build_plans set invalidated_at=clock_timestamp()
    where event_id=(select event_id from public.competitions where id=old.competition_id) and invalidated_at is null;
  return old;
end $$;
revoke execute on function private.invalidate_tournament_build_plan() from public,anon,authenticated;
create trigger invalidate_tournament_build_plan before delete on public.matches for each row execute function private.invalidate_tournament_build_plan();
do $patch$
declare body text;
  lookup text:='select b.summary into summary from private.tournament_build_plans b where event_id=p_event and payload_hash=fingerprint;';
  save text:='insert into private.tournament_build_plans(event_id,payload_hash,summary) values(p_event,fingerprint,summary);';
begin
  body:=pg_get_functiondef('public.build_tournament_plan(uuid,integer,jsonb)'::regprocedure);
  if strpos(body,lookup)=0 or strpos(body,save)=0 then raise exception 'tournament build receipt patch anchor missing'; end if;
  body:=replace(body,lookup,'select b.summary into summary from private.tournament_build_plans b where event_id=p_event and payload_hash=fingerprint and invalidated_at is null;');
  execute replace(body,save,'insert into private.tournament_build_plans(event_id,payload_hash,summary) values(p_event,fingerprint,summary) on conflict(event_id,payload_hash) do update set summary=excluded.summary, invalidated_at=null, generation=private.tournament_build_plans.generation+1;');
end $patch$;
