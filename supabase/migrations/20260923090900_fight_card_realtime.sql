-- Realtime support for independent tournament fields.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fight_cards'
  ) then
    alter publication supabase_realtime add table public.fight_cards;
  end if;
end;
$$;
