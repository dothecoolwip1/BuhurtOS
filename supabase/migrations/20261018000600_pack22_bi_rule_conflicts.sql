-- Pack 22: disagreements found between Buhurt International documents while importing release 2026-10-06, recorded in rule_conflicts
-- (open, never decided by BuhurtOS). Additive, data only, idempotent: a conflict already recorded for the same two provisions is left alone.
--
-- Found by reading the imported text (rules-library/buhurt-international/releases/2026-10-06/structured/):
--   * League Structure 26.1 2.3.4 (Regional) table: "Points given | 150 %"; 2.3.5 (Conference) table: "Points given | 200 %";
--   * League Structure 26.1 3.3.2 "The multiplier for each tier": "x1 for Classic / x1.25 for Regional / x1.5 for Conference";
--   * Tournament Structure (January 2026) 4.2 "Multiplier for Tier of Event": "1.25x points for Regional ... 1.5x points for Conference".
-- public.ref_tiers (foundation migration) already stores both readings side by side (multiplier 1.25 / 1.5 and percentage 1.5 / 2); nothing changes it.

do $$
declare
  c record;
  v_a uuid; v_pa uuid; v_b uuid; v_pb uuid; v_id uuid;
begin
  for c in
    select * from (values
      ('tournament/league-structure', 'league-structure:2.3.4', 'tournament/league-structure', 'league-structure:3.3.2',
       'Regional tier: League Structure 2.3.4 gives "Points given 150 %" for a Regional tournament, while 3.3.2 of the same document gives "x1.25 for Regional" (Tournament Structure 4.2 also says 1.25x). Recorded by the Pack 22 import; BuhurtOS does not decide which applies.'),
      ('tournament/league-structure', 'league-structure:2.3.5', 'tournament/league-structure', 'league-structure:3.3.2',
       'Conference tier: League Structure 2.3.5 gives "Points given 200 %" for a Conference tournament, while 3.3.2 of the same document gives "x1.5 for Conference" (Tournament Structure 4.2 also says 1.5x). Recorded by the Pack 22 import; BuhurtOS does not decide which applies.'),
      ('tournament/league-structure', 'league-structure:2.3.4', 'tournament/tournament-structure', 'tournament-structure:4.2',
       'Regional and Conference tiers across documents: League Structure 2.3.4 and 2.3.5 give "Points given" of 150 % and 200 %, Tournament Structure 4.2 gives 1.25x and 1.5x. Recorded by the Pack 22 import; BuhurtOS does not decide which applies.')
    ) t(doc_a, key_a, doc_b, key_b, description)
  loop
    select v.id, p.id into v_a, v_pa
      from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id join public.rule_provisions p on p.ruleset_version_id = v.id
     where r.governing_body = 'Buhurt International' and r.inventory_key = c.doc_a and v.import_release = '2026-10-06' and p.stable_key = c.key_a;
    select v.id, p.id into v_b, v_pb
      from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id join public.rule_provisions p on p.ruleset_version_id = v.id
     where r.governing_body = 'Buhurt International' and r.inventory_key = c.doc_b and v.import_release = '2026-10-06' and p.stable_key = c.key_b;
    if v_pa is null or v_pb is null then
      raise exception 'Pack 22 conflicts: provision % or % of release 2026-10-06 not found', c.key_a, c.key_b;
    end if;
    if exists (select 1 from public.rule_conflicts where provision_a = v_pa and provision_b = v_pb) then continue; end if;
    insert into public.rule_conflicts (governing_body, version_a, provision_a, version_b, provision_b, description, noted_by)
    values ('Buhurt International', v_a, v_pa, v_b, v_pb, c.description, null) returning id into v_id;
    perform private.audit(null, 'rules.conflict_noted', v_id::text, jsonb_build_object('a', v_pa, 'b', v_pb, 'by', 'Pack 22 import, release 2026-10-06'));
  end loop;
end $$;
