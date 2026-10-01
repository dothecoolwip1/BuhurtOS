-- An organizer records the insurance state of a registration, for example when proof of cover arrives.
-- People choose their own answer when registering; only an organizer can move it to 'proof_received' (or back).
create or replace function public.set_registration_insurance(p_reg uuid, p_insurance text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_organizer(private.reg_event(p_reg)) then raise exception 'only an organizer can record insurance' using errcode = '42501'; end if;
  if p_insurance is null or p_insurance not in ('hacsa_member', 'mcc_member', 'proof_received', 'proof_pending', 'needs_cover') then
    raise exception 'unknown insurance state' using errcode = '22023'; end if;
  update public.registrations set insurance = p_insurance where id = p_reg;
  perform private.audit(private.reg_event(p_reg), 'registration.insurance', p_reg::text, jsonb_build_object('insurance', p_insurance));
end $$;
revoke execute on function public.set_registration_insurance(uuid, text) from public, anon;
grant execute on function public.set_registration_insurance(uuid, text) to authenticated;
