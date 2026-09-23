import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { checkCompliance } from '../lib/compliance';
import { generateDoubleElimination, generateRoundRobin, generateSingleElimination } from '../lib/bracket';
import { addGhostFighter, saveBracketPlan } from '../lib/adminActions';
import { inviteEventMember, listEventMemberships, removeEventMembership, type EventMembershipView } from '../lib/memberAdmin';
import type { EventRole } from '../types';

const assignableRoles: Array<{value: EventRole; label: string}> = [
  { value: 'event_organizer', label: 'Event Organizer' },
  { value: 'tournament_director', label: 'Tournament Director' },
  { value: 'scorekeeper', label: 'Scorekeeper' },
  { value: 'registration_staff', label: 'Registration Staff' },
  { value: 'armor_inspector', label: 'Armor Inspector' },
  { value: 'medical_staff', label: 'Medical Staff' },
  { value: 'field_marshal', label: 'Field Marshal' },
  { value: 'assistant_marshal', label: 'Assistant Marshal' },
  { value: 'team_captain', label: 'Team Captain' },
  { value: 'fighter', label: 'Fighter' }
];

export function AdminPage() {
  const { event, roster, reload } = useAppState();
  const [ghostName, setGhostName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [bracketFormat, setBracketFormat] = useState<'single_elimination'|'double_elimination'|'round_robin'>('single_elimination');
  const [busy, setBusy] = useState(false);
  const [memberships, setMemberships] = useState<EventMembershipView[]>([]);
  const [memberForm, setMemberForm] = useState<{email:string; displayName:string; role:EventRole; teamId:string}>({ email:'', displayName:'', role:'field_marshal', teamId:'' });
  const eligible = useMemo(() => roster.filter(r => checkCompliance(r).eligible), [roster]);
  const teamOptions = useMemo(() => [...new Set(roster.map(entry => entry.teamId).filter((id): id is string => Boolean(id)))].map(id => ({ id, label: roster.filter(entry => entry.teamId === id).slice(0,2).map(entry => entry.displayName).join(', ') || `Team ${id.slice(0,8)}` })), [roster]);

  const loadMembers = async () => {
    if (!event) return;
    try { setMemberships(await listEventMemberships(event.id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load event access.'); }
  };
  useEffect(() => { loadMembers(); }, [event?.id]);
  if (!event) return null;

  const addGhost = async () => {
    if (!ghostName.trim()) return;
    setBusy(true); setMessage('');
    try { await addGhostFighter(event, ghostName.trim()); setGhostName(''); await reload(); setMessage('Ghost fighter added. Complete compliance before bracket placement.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to add ghost fighter.'); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    const chosen = eligible.filter(r => selected.includes(r.id));
    if (chosen.length < 2) return setMessage('Choose at least two cleared competitors.');
    setBusy(true); setMessage('');
    try {
      const bracketId = crypto.randomUUID();
      const common = { organizationId: event.organizationId, seasonId: event.seasonId, eventId: event.id, bracketId, category: 'Duel', matchType: 'longsword', entries: chosen.map((entry,index) => ({ entry, seed: index + 1 })), scoringConfig: { kind: 'duel' as const, roundsRequired: 3, allowDrawRound: false, scoreCapPerRound: 10 } };
      const plan = bracketFormat === 'double_elimination'
        ? generateDoubleElimination(common)
        : bracketFormat === 'round_robin'
          ? generateRoundRobin(common)
          : generateSingleElimination(common);
      await saveBracketPlan(event, plan, { id: bracketId, name: `Duel ${bracketFormat.replaceAll('_',' ')} ${new Date().toLocaleDateString()}`, category: 'Duel', format: bracketFormat });
      await reload();
      setMessage(`${bracketFormat.replaceAll('_',' ')} competition created with ${plan.matches.length} matches.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to create bracket.'); }
    finally { setBusy(false); }
  };
  const addMember = async () => {
    if (!memberForm.email.trim()) return;
    if (memberForm.role === 'team_captain' && !memberForm.teamId) return setMessage('Choose a team for the captain.');
    setBusy(true); setMessage('');
    try {
      const result = await inviteEventMember({ eventId:event.id, email:memberForm.email.trim(), displayName:memberForm.displayName.trim() || undefined, role:memberForm.role, teamId:memberForm.role === 'team_captain' ? memberForm.teamId : undefined });
      await loadMembers();
      setMemberForm({ email:'', displayName:'', role:'field_marshal', teamId:'' });
      setMessage(result.invited ? 'Invitation sent and event access assigned.' : 'Existing account found and event access assigned.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to assign event access.'); }
    finally { setBusy(false); }
  };
  const removeMember = async (id: string) => {
    setBusy(true); setMessage('');
    try { await removeEventMembership(id); await loadMembers(); setMessage('Event role removed.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to remove event role.'); }
    finally { setBusy(false); }
  };

  return <>
    <section className="section-head"><div><span className="eyebrow">Event setup</span><h1>Organizer Tools</h1><p>Administrative actions are kept separate from live field controls.</p></div></section>
    <div className="admin-grid">
      <section className="panel-card"><h2>Add ghost fighter</h2><p>Create an event-only identity immediately. It can later be linked to a permanent fighter without changing historical match references.</p><div className="inline-form"><input value={ghostName} onChange={e => setGhostName(e.target.value)} placeholder="Display name"/><button className="primary" disabled={busy} onClick={addGhost}>Add</button></div></section>
      <section className="panel-card"><h2>Create competition bracket</h2><p>Only cleared competitors are selectable. Seeding is deterministic, same-team separation is attempted where applicable, and double elimination preserves two-loss protection.</p><label className="form-stack">Format<select value={bracketFormat} onChange={e=>setBracketFormat(e.target.value as typeof bracketFormat)}><option value="single_elimination">Single elimination</option><option value="double_elimination">Double elimination</option><option value="round_robin">Round robin</option></select></label>{bracketFormat==='double_elimination'&&selected.length>0&&((selected.length&(selected.length-1))!==0)&&<div className="validation-errors">Double elimination requires 4, 8, 16, 32, or another power-of-two field. Use pools or round robin first when the field size is uneven.</div>}<div className="selector-list">{eligible.map(entry => <label key={entry.id}><input type="checkbox" checked={selected.includes(entry.id)} onChange={e => setSelected(current => e.target.checked ? [...current, entry.id] : current.filter(id => id !== entry.id))}/><span>{entry.displayName}</span></label>)}</div><button className="primary big" disabled={busy || selected.length < 2 || (bracketFormat==='double_elimination'&&(selected.length<4||(selected.length&(selected.length-1))!==0))} onClick={generate}>Create Competition</button></section>
      <section className="panel-card"><h2>Invite event member</h2><p>Invitations are handled server-side. Service credentials never enter the browser.</p><div className="form-stack"><label>Email<input type="email" value={memberForm.email} onChange={e=>setMemberForm(f=>({...f,email:e.target.value}))}/></label><label>Display name<input value={memberForm.displayName} onChange={e=>setMemberForm(f=>({...f,displayName:e.target.value}))}/></label><label>Role<select value={memberForm.role} onChange={e=>setMemberForm(f=>({...f,role:e.target.value as EventRole,teamId:e.target.value === 'team_captain' ? f.teamId : ''}))}>{assignableRoles.map(role=><option key={role.value} value={role.value}>{role.label}</option>)}</select></label>{memberForm.role === 'team_captain' && <label>Captain team<select value={memberForm.teamId} onChange={e=>setMemberForm(f=>({...f,teamId:e.target.value}))}><option value="">Choose team</option>{teamOptions.map(team=><option key={team.id} value={team.id}>{team.label}</option>)}</select></label>}<button className="primary big" disabled={busy || !memberForm.email} onClick={addMember}>Invite / Assign Access</button></div></section>
      <section className="panel-card"><h2>Event access</h2><p>Removing a role only removes access for this event. It does not delete the account or fighter history.</p><div className="membership-list">{memberships.length === 0 ? <div className="state-card">No managed event roles are visible yet.</div> : memberships.map(member=><article key={member.id}><div><strong>{member.displayName}</strong><small>{member.role.replaceAll('_',' ')}{member.teamId ? ` · team ${member.teamId.slice(0,8)}` : ''}</small></div><button disabled={busy} onClick={()=>removeMember(member.id)}>Remove</button></article>)}</div></section>
    </div>
    {message && <div className="auth-message">{message}</div>}
  </>;
}
