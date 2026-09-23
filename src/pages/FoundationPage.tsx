import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { competitionFormats } from '../lib/competitionFormats';
import {
  claimTemporaryFighter,
  createAffiliation,
  createClub,
  createDivision,
  findDuplicateFighterCandidates,
  listAffiliations,
  listClubs,
  listDivisions,
  listFoundationFighters,
  listTeams,
  mergeFoundationFighters
} from '../lib/identityAdmin';
import type { AffiliationType, Club, CompetitionDivision, FighterAffiliation, FoundationFighter, Team } from '../types';

const today = () => new Date().toISOString().slice(0, 10);

export function FoundationPage() {
  const { event, roster, user, dataMode, reload } = useAppState();
  const [fighters, setFighters] = useState<FoundationFighter[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [divisions, setDivisions] = useState<CompetitionDivision[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [affiliations, setAffiliations] = useState<FighterAffiliation[]>([]);
  const [clubForm, setClubForm] = useState({ name: '', shortName: '', region: '' });
  const [divisionForm, setDivisionForm] = useState({ name: '', competitionFormatId: competitionFormats[0]?.id || 'longsword', teamSize: '', eligibilityLabel: '' });
  const [claimForm, setClaimForm] = useState({ rosterEntryId: '', fighterId: '' });
  const [mergeForm, setMergeForm] = useState({ canonical: '', duplicate: '' });
  const [affiliationForm, setAffiliationForm] = useState({ fighterId: '', clubId: '', teamId: '', affiliationType: 'member' as AffiliationType, startsOn: today(), endsOn: '', isPrimary: true });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = Boolean(
    dataMode === 'demo'
    || user?.platformRoles.includes('platform_super_admin')
    || (event && user?.organizationRoles.some(role => role.organizationId === event.organizationId && role.role === 'organization_admin'))
  );

  const temporaryEntries = useMemo(() => roster.filter(entry => entry.entryType === 'ghost_fighter' || entry.entryType === 'guest_fighter'), [roster]);
  const duplicatePairs = useMemo(() => findDuplicateFighterCandidates(fighters), [fighters]);

  const refresh = async () => {
    if (!event) return;
    const [fighterRows, clubRows, divisionRows, teamRows, affiliationRows] = await Promise.all([
      listFoundationFighters(event, roster),
      listClubs(event.organizationId),
      listDivisions(event.organizationId),
      listTeams(event.organizationId),
      listAffiliations(event.organizationId)
    ]);
    setFighters(fighterRows);
    setClubs(clubRows);
    setDivisions(divisionRows);
    setTeams(teamRows);
    setAffiliations(affiliationRows);
  };

  useEffect(() => {
    refresh().catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load foundation data.'));
  }, [event?.id, roster.length]);

  if (!event) return <div className="state-card">Choose an event before opening the identity foundation.</div>;
  if (!canManage) return <div className="state-card">Organization administrator access is required for permanent identity and affiliation management.</div>;

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await reload();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The requested change could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const addClub = () => run(async () => {
    await createClub(event.organizationId, clubForm);
    setClubForm({ name: '', shortName: '', region: '' });
  }, 'Club created.');

  const addDivision = () => run(async () => {
    await createDivision(event.organizationId, {
      name: divisionForm.name,
      competitionFormatId: divisionForm.competitionFormatId,
      teamSize: divisionForm.teamSize ? Number(divisionForm.teamSize) : undefined,
      eligibilityLabel: divisionForm.eligibilityLabel || undefined
    });
    setDivisionForm({ name: '', competitionFormatId: competitionFormats[0]?.id || 'longsword', teamSize: '', eligibilityLabel: '' });
  }, 'Division created as a draft.');

  const claim = () => {
    const entry = temporaryEntries.find(row => row.id === claimForm.rosterEntryId);
    if (!entry) return setMessage('Choose a temporary fighter first.');
    return run(async () => {
      await claimTemporaryFighter(event, entry.id, claimForm.fighterId || undefined, entry.displayName);
      setClaimForm({ rosterEntryId: '', fighterId: '' });
    }, 'Temporary fighter is now linked to a permanent identity. Historical roster references were preserved.');
  };

  const merge = () => run(async () => {
    await mergeFoundationFighters(event, roster, mergeForm.canonical, mergeForm.duplicate);
    setMergeForm({ canonical: '', duplicate: '' });
  }, 'Duplicate fighter merged into the canonical record. Event history now points to the canonical fighter.');

  const addAffiliation = () => {
    const fighter = fighters.find(row => row.id === affiliationForm.fighterId);
    if (!fighter) return setMessage('Choose a fighter.');
    return run(async () => {
      await createAffiliation({
        identityId: fighter.identityId,
        organizationId: event.organizationId,
        clubId: affiliationForm.clubId || undefined,
        teamId: affiliationForm.teamId || undefined,
        affiliationType: affiliationForm.affiliationType,
        startsOn: affiliationForm.startsOn,
        endsOn: affiliationForm.endsOn || undefined,
        isPrimary: affiliationForm.isPrimary,
        sourceEventId: event.id
      });
    }, 'Affiliation history updated.');
  };

  return <>
    <section className="section-head">
      <div>
        <span className="eyebrow">Permanent foundation</span>
        <h1>Identity, Clubs & Divisions</h1>
        <p>Manage durable fighter identities and history separately from event-day roster entries. Claims and merges preserve the roster IDs already referenced by matches and results.</p>
      </div>
    </section>

    <div className="admin-grid">
      <section className="panel-card">
        <h2>Claim temporary fighter</h2>
        <p>Turn a ghost or guest entry into a permanent fighter, or attach it to an existing fighter without rewriting match history.</p>
        <div className="form-stack">
          <label>Temporary roster entry
            <select value={claimForm.rosterEntryId} onChange={e => setClaimForm(form => ({ ...form, rosterEntryId: e.target.value }))}>
              <option value="">Choose fighter</option>
              {temporaryEntries.map(entry => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
            </select>
          </label>
          <label>Permanent fighter
            <select value={claimForm.fighterId} onChange={e => setClaimForm(form => ({ ...form, fighterId: e.target.value }))}>
              <option value="">Create a new permanent fighter</option>
              {fighters.map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}</option>)}
            </select>
          </label>
          <button className="primary big" disabled={busy || !claimForm.rosterEntryId} onClick={claim}>Claim Fighter</button>
        </div>
        {temporaryEntries.length === 0 && <div className="state-card">No temporary fighters are waiting to be claimed.</div>}
      </section>

      <section className="panel-card">
        <h2>Merge duplicate fighters</h2>
        <p>The canonical fighter survives. Roster entries, discipline records and affiliation history are rewired while the duplicate is soft-deleted for auditability.</p>
        {duplicatePairs.length > 0 && <div className="state-card">{duplicatePairs.length} exact-name duplicate pair{duplicatePairs.length === 1 ? '' : 's'} detected.</div>}
        <div className="form-stack">
          <label>Keep
            <select value={mergeForm.canonical} onChange={e => setMergeForm(form => ({ ...form, canonical: e.target.value }))}>
              <option value="">Canonical fighter</option>
              {fighters.map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}</option>)}
            </select>
          </label>
          <label>Merge away
            <select value={mergeForm.duplicate} onChange={e => setMergeForm(form => ({ ...form, duplicate: e.target.value }))}>
              <option value="">Duplicate fighter</option>
              {fighters.filter(fighter => fighter.id !== mergeForm.canonical).map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}</option>)}
            </select>
          </label>
          <button disabled={busy || !mergeForm.canonical || !mergeForm.duplicate} onClick={merge}>Merge Fighter Records</button>
        </div>
      </section>

      <section className="panel-card">
        <h2>Clubs</h2>
        <p>Clubs are durable organization-level homes. Teams can sit under clubs while fighter affiliation history remains time-based.</p>
        <div className="form-stack">
          <input placeholder="Club name" value={clubForm.name} onChange={e => setClubForm(form => ({ ...form, name: e.target.value }))}/>
          <input placeholder="Short name" value={clubForm.shortName} onChange={e => setClubForm(form => ({ ...form, shortName: e.target.value }))}/>
          <input placeholder="Region" value={clubForm.region} onChange={e => setClubForm(form => ({ ...form, region: e.target.value }))}/>
          <button disabled={busy || !clubForm.name.trim()} onClick={addClub}>Add Club</button>
        </div>
        <div className="membership-list">
          {clubs.length === 0 ? <div className="state-card">No clubs created yet.</div> : clubs.map(club => <article key={club.id}><div><strong>{club.name}</strong><small>{[club.shortName, club.region].filter(Boolean).join(' · ') || 'No extra details'}</small></div></article>)}
        </div>
      </section>

      <section className="panel-card">
        <h2>Competition divisions</h2>
        <p>Define reusable divisions independently from a tournament bracket. A division can later be attached to an event and a versioned ruleset.</p>
        <div className="form-stack">
          <input placeholder="Division name" value={divisionForm.name} onChange={e => setDivisionForm(form => ({ ...form, name: e.target.value }))}/>
          <label>Competition format
            <select value={divisionForm.competitionFormatId} onChange={e => setDivisionForm(form => ({ ...form, competitionFormatId: e.target.value }))}>
              {competitionFormats.map(format => <option key={format.id} value={format.id}>{format.name}</option>)}
            </select>
          </label>
          <input type="number" min="1" placeholder="Team size, if fixed" value={divisionForm.teamSize} onChange={e => setDivisionForm(form => ({ ...form, teamSize: e.target.value }))}/>
          <input placeholder="Eligibility label, optional" value={divisionForm.eligibilityLabel} onChange={e => setDivisionForm(form => ({ ...form, eligibilityLabel: e.target.value }))}/>
          <button disabled={busy || !divisionForm.name.trim()} onClick={addDivision}>Create Draft Division</button>
        </div>
        <div className="membership-list">
          {divisions.length === 0 ? <div className="state-card">No formal divisions created yet.</div> : divisions.map(division => <article key={division.id}><div><strong>{division.name}</strong><small>{division.competitionFormatId.replaceAll('_', ' ')} · {division.status}</small></div></article>)}
        </div>
      </section>

      <section className="panel-card">
        <h2>Affiliation history</h2>
        <p>Record when a fighter represented a club or team, including mercenary and guest periods. Past affiliations are retained instead of overwriting the fighter record.</p>
        <div className="form-stack">
          <label>Fighter
            <select value={affiliationForm.fighterId} onChange={e => setAffiliationForm(form => ({ ...form, fighterId: e.target.value }))}>
              <option value="">Choose fighter</option>
              {fighters.map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}</option>)}
            </select>
          </label>
          <label>Type
            <select value={affiliationForm.affiliationType} onChange={e => setAffiliationForm(form => ({ ...form, affiliationType: e.target.value as AffiliationType }))}>
              <option value="member">Member</option>
              <option value="mercenary">Mercenary</option>
              <option value="guest">Guest</option>
              <option value="independent">Independent</option>
            </select>
          </label>
          <label>Club
            <select value={affiliationForm.clubId} onChange={e => setAffiliationForm(form => ({ ...form, clubId: e.target.value }))}>
              <option value="">No club</option>
              {clubs.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}
            </select>
          </label>
          <label>Team
            <select value={affiliationForm.teamId} onChange={e => setAffiliationForm(form => ({ ...form, teamId: e.target.value }))}>
              <option value="">No team</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label>Start date<input type="date" value={affiliationForm.startsOn} onChange={e => setAffiliationForm(form => ({ ...form, startsOn: e.target.value }))}/></label>
          <label>End date<input type="date" value={affiliationForm.endsOn} onChange={e => setAffiliationForm(form => ({ ...form, endsOn: e.target.value }))}/></label>
          <label><input type="checkbox" checked={affiliationForm.isPrimary} onChange={e => setAffiliationForm(form => ({ ...form, isPrimary: e.target.checked }))}/> Primary affiliation</label>
          <button disabled={busy || !affiliationForm.fighterId} onClick={addAffiliation}>Add Affiliation</button>
        </div>
        <div className="membership-list">
          {affiliations.length === 0 ? <div className="state-card">No affiliation history recorded yet.</div> : affiliations.slice(0, 12).map(row => {
            const fighter = fighters.find(item => item.identityId === row.identityId);
            const club = clubs.find(item => item.id === row.clubId);
            const team = teams.find(item => item.id === row.teamId);
            return <article key={row.id}><div><strong>{fighter?.name || 'Fighter'}</strong><small>{row.affiliationType} · {club?.name || team?.name || 'Independent'} · {row.startsOn}{row.endsOn ? ' to ' + row.endsOn : ' to present'}</small></div></article>;
          })}
        </div>
      </section>
    </div>

    {message && <div className="auth-message">{message}</div>}
  </>;
}
