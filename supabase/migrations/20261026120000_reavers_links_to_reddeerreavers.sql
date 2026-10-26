-- The Red Deer Reavers site now has its own address, https://reddeerreavers.com. The old addresses forward there,
-- but Discord alerts and pushes built by BuhurtOS functions should link to it directly (meeting and RSVP links went to
-- red-deer-reavers.vercel.app; anything missed by 20261017130000 still points at github.io). Rewrites the function
-- bodies in place, so every alert sent from now on (including for meetings already open) uses the new address.
-- Idempotent: a second run finds nothing to change.
do $$
declare r record; src text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public') and p.prokind = 'f'
      and (pg_get_functiondef(p.oid) like '%https://red-deer-reavers.vercel.app/%'
        or pg_get_functiondef(p.oid) like '%https://dothecoolwip1.github.io/Red-deer-reavers/%')
  loop
    src := pg_get_functiondef(r.oid);
    src := replace(src, 'https://red-deer-reavers.vercel.app/', 'https://reddeerreavers.com/');
    src := replace(src, 'https://dothecoolwip1.github.io/Red-deer-reavers/', 'https://reddeerreavers.com/');
    execute src;
  end loop;
end $$;
