-- The Red Deer Reavers site now lives at https://red-deer-reavers.vercel.app (GitHub Pages is a mirror of the same code).
-- Every Discord alert and push built by the private.reavers_* functions linked to the old github.io address; rewrite them
-- in place so the links in Discord open the live site. Idempotent: a second run finds nothing to change.
do $$
declare r record; src text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%https://dothecoolwip1.github.io/Red-deer-reavers/%'
  loop
    src := replace(pg_get_functiondef(r.oid), 'https://dothecoolwip1.github.io/Red-deer-reavers/', 'https://red-deer-reavers.vercel.app/');
    execute src;
  end loop;
end $$;
update private.push_config set value = 'https://buhurt-os.vercel.app/' where key = 'vapid_subject' and value like '%github.io%';
