import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import {
  allowedInviteRoles,
  archiveGovernanceClub,
  archiveGovernanceTeam,
  cancelMembershipRequest,
  changeMembershipRole,
  createGovernanceClub,
  createGovernanceTeam,
  createMembershipInvitation,
  createOrganizationRelationship,
  createSubordinateOrganization,
  endMembership,
  endOrganizationRelationship,
  loadGovernanceSnapshot,
  membershipInvitePath,
  requestMembership,
  reviewMembershipApplication,
  setGovernanceTeamStatus,
  updateGovernanceClub,
  updateGovernanceTeam,
  type GovernanceAuthority,
  type GovernanceSnapshot
} from '../lib/organizationAdmin';
import type {
  Club,
  ClubRole,
  EntityVisibility,
  MembershipRequest,
  MembershipScope,
  OrganizationKind,
  Team,
  TeamRole,
  TeamStatus
} from '../types';

const emptySnapshot: GovernanceSnapshot = {
  organizations: [],
  relationships: [],
  clubs: [],
  teams: [],
  clubMemberships: [],
  teamMemberships: [],
  requests: []
};

const organizationKinds: OrganizationKind[] = [
  'international_federation',
  'national_federation',
  'regional_organization',
  'local_organization',
  'independent_organization'
];

const teamStatuses: Exclude<TeamStatus, 'archived'>[] = ['forming', 'pending', 'active', 'suspended'];

const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export function OrganizationManagementPage() {
  const { event, user, reload, dataMode } = useAppState();
  const [snapshot, setSnapshot] = useState<GovernanceSnapshot>(emptySnapshot);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState('');

  const [orgForm, setOrgForm] = useState({
    name: '',
    shortName: '',
    region: '',
    kind: 'local_organization' as OrganizationKind,
    visibility: 'members' as EntityVisibility
  });
  const [relationshipForm, setRelationshipForm] = useState({
    parentId: '',
    childId: '',
    kind: 'governs' as const
  });
  const [clubForm, setClubForm] = useState({
    name: '',
    shortName: '',
    region: '',
    visibility: 'members' as EntityVisibility,
    description: '',
    websiteUrl: ''
  });
  const [editingClubId, setEditingClubId] = useState('');
  const [teamForm, setTeamForm] = useState({
    name: '',
    shortName: '',
    region: '',
    clubId: '',
    visibility: 'members' as EntityVisibility,
    description: ''
  });
  const [editingTeamId, setEditingTeamId] = useState('');
  const [inviteForm, setInviteForm] = useState({
    scope: 'team' as MembershipScope,
    targetId: '',
    email: '',
    role: 'fighter' as ClubRole | TeamRole,
    message: ''
  });
  const [applicationForm, setApplicationForm] = useState({
    scope: 'team' as MembershipScope,
    targetId: '',
    role: 'fighter' as ClubRole | TeamRole,
    message: ''
  });

  const organizationId = event?.organizationId || '';
  const platformAdmin = Boolean(user?.platformRoles.includes('platform_super_admin'));
  const organizationAdmin = Boolean(
    platformAdmin
    || (organizationId && user?.organizationRoles.some(role => role.organizationId === organizationId && role.role === 'organization_admin'))
  );

  const refresh = async () => {
    if (!organizationId) return;
    setSnapshot(await loadGovernanceSnapshot(organizationId));
  };

  useEffect(() => {
    refresh().catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load organization data.'));
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    setRelationshipForm(form => ({
      ...form,
      parentId: form.parentId || organizationId
    }));
  }, [organizationId]);

  useEffect(() => {
    const choices = inviteForm.scope === 'club' ? snapshot.clubs : snapshot.teams;
    if (inviteForm.targetId && choices.some(row => row.id === inviteForm.targetId)) return;
    const first = choices[0]?.id || '';
    setInviteForm(form => ({ ...form, targetId: first }));
  }, [inviteForm.scope, snapshot.clubs, snapshot.teams]);

  useEffect(() => {
    const choices = applicationForm.scope === 'club' ? snapshot.clubs : snapshot.teams.filter(team => team.status === 'active');
    if (applicationForm.targetId && choices.some(row => row.id === applicationForm.targetId)) return;
    const first = choices[0]?.id || '';
    setApplicationForm(form => ({ ...form, targetId: first }));
  }, [applicationForm.scope, snapshot.clubs, snapshot.teams]);

  if (!event) return <div className="state-card">Choose an event before opening organization management.</div>;
  if (!user) return <div className="state-card">Sign in to manage organizations, clubs, teams, or memberships.</div>;

  const clubAuthority = (clubId: string): GovernanceAuthority => ({
    platformAdmin,
    organizationAdmin,
    clubAdmin: Boolean(user.clubRoles.some(role => role.clubId === clubId && role.role === 'club_admin')),
    teamAdmin: false,
    captain: false
  });

  const teamAuthority = (team: Team): GovernanceAuthority => ({
    platformAdmin,
    organizationAdmin,
    clubAdmin: Boolean(team.clubId && user.clubRoles.some(role => role.clubId === team.clubId && role.role === 'club_admin')),
    teamAdmin: Boolean(user.teamRoles.some(role => role.teamId === team.id && role.role === 'team_admin')),
    captain: Boolean(user.teamRoles.some(role => role.teamId === team.id && role.role === 'captain'))
  });

  const canManageClub = (clubId: string) => allowedInviteRoles('club', clubAuthority(clubId)).length > 0;
  const canManageTeam = (team: Team) => allowedInviteRoles('team', teamAuthority(team)).length > 0;

  const selectedInviteClub = snapshot.clubs.find(row => row.id === inviteForm.targetId);
  const selectedInviteTeam = snapshot.teams.find(row => row.id === inviteForm.targetId);
  const selectedInviteAuthority = inviteForm.scope === 'club'
    ? clubAuthority(selectedInviteClub?.id || '')
    : teamAuthority(selectedInviteTeam || { id: '', organizationId, name: '' });
  const inviteRoles = allowedInviteRoles(inviteForm.scope, selectedInviteAuthority);

  const pendingRequests = snapshot.requests.filter(row => row.status === 'pending');

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

  const saveClub = () => run(async () => {
    const input = {
      name: clubForm.name,
      shortName: clubForm.shortName || undefined,
      region: clubForm.region || undefined,
      visibility: clubForm.visibility,
      description: clubForm.description || undefined,
      websiteUrl: clubForm.websiteUrl || undefined
    };
    if (editingClubId) await updateGovernanceClub(organizationId, editingClubId, input);
    else await createGovernanceClub(organizationId, input);
    setEditingClubId('');
    setClubForm({ name: '', shortName: '', region: '', visibility: 'members', description: '', websiteUrl: '' });
  }, editingClubId ? 'Club updated.' : 'Club created.');

  const editClub = (club: Club) => {
    setEditingClubId(club.id);
    setClubForm({
      name: club.name,
      shortName: club.shortName || '',
      region: club.region || '',
      visibility: club.visibility || 'members',
      description: club.publicDescription || '',
      websiteUrl: club.websiteUrl || ''
    });
  };

  const saveTeam = () => run(async () => {
    const input = {
      clubId: teamForm.clubId || undefined,
      name: teamForm.name,
      shortName: teamForm.shortName || undefined,
      region: teamForm.region || undefined,
      visibility: teamForm.visibility,
      description: teamForm.description || undefined
    };
    if (editingTeamId) await updateGovernanceTeam(organizationId, editingTeamId, input);
    else await createGovernanceTeam(organizationId, input);
    setEditingTeamId('');
    setTeamForm({ name: '', shortName: '', region: '', clubId: '', visibility: 'members', description: '' });
  }, editingTeamId ? 'Team updated.' : 'Team created.');

  const editTeam = (team: Team) => {
    setEditingTeamId(team.id);
    setTeamForm({
      name: team.name,
      shortName: team.shortName || '',
      region: team.cityOrRegion || '',
      clubId: team.clubId || '',
      visibility: team.visibility || 'members',
      description: team.publicDescription || ''
    });
  };

  const createInvite = () => run(async () => {
    const role = inviteForm.role;
    const token = await createMembershipInvitation(organizationId, {
      scope: inviteForm.scope,
      targetId: inviteForm.targetId,
      email: inviteForm.email,
      clubRole: inviteForm.scope === 'club' ? role as ClubRole : undefined,
      teamRole: inviteForm.scope === 'team' ? role as TeamRole : undefined,
      message: inviteForm.message || undefined
    });
    const path = membershipInvitePath(token);
    const absolute = typeof window === 'undefined'
      ? path
      : window.location.origin + window.location.pathname + '#' + path;
    setInviteLink(absolute);
    setInviteForm(form => ({ ...form, email: '', message: '' }));
  }, 'Invitation created. Share the acceptance link with the invited person.');

  const apply = () => run(async () => {
    await requestMembership(organizationId, {
      scope: applicationForm.scope,
      targetId: applicationForm.targetId,
      clubRole: applicationForm.scope === 'club' ? 'member' : undefined,
      teamRole: applicationForm.scope === 'team' ? applicationForm.role as TeamRole : undefined,
      message: applicationForm.message || undefined,
      userId: user.userId,
      displayName: user.displayName
    });
    setApplicationForm(form => ({ ...form, message: '' }));
  }, 'Membership application submitted.');

  const canManageRequest = (request: MembershipRequest) => {
    if (request.scope === 'club') return Boolean(request.clubId && canManageClub(request.clubId));
    const team = snapshot.teams.find(row => row.id === request.teamId);
    return Boolean(team && canManageTeam(team));
  };

  const relationshipRows = useMemo(
    () => snapshot.relationships.filter(row => !row.endsOn),
    [snapshot.relationships]
  );

  return <>
    <section className="section-head">
      <div>
        <span className="eyebrow">Pack 4 operations</span>
        <h1>Organizations, Clubs & Teams</h1>
        <p>Manage governing relationships, club and team lifecycle, delegated leadership, historical memberships, applications, and secure invitations without rewriting sporting history.</p>
      </div>
      <div className="header-actions">
        <span className="status-chip">{dataMode === 'demo' ? 'Demo persistence' : 'Supabase secured'}</span>
      </div>
    </section>

    {message && <div className="auth-message">{message}</div>}

    <div className="admin-grid">
      <section className="panel-card">
        <h2>Organization hierarchy</h2>
        <p>Build federation and organization relationships without hardcoding a specific governing structure.</p>
        {organizationAdmin ? <div className="form-stack">
          <input value={orgForm.name} onChange={e => setOrgForm(form => ({ ...form, name: e.target.value }))} placeholder="Organization name"/>
          <input value={orgForm.shortName} onChange={e => setOrgForm(form => ({ ...form, shortName: e.target.value }))} placeholder="Short name"/>
          <input value={orgForm.region} onChange={e => setOrgForm(form => ({ ...form, region: e.target.value }))} placeholder="Region"/>
          <label>Organization type
            <select value={orgForm.kind} onChange={e => setOrgForm(form => ({ ...form, kind: e.target.value as OrganizationKind }))}>
              {organizationKinds.map(kind => <option key={kind} value={kind}>{label(kind)}</option>)}
            </select>
          </label>
          <label>Visibility
            <select value={orgForm.visibility} onChange={e => setOrgForm(form => ({ ...form, visibility: e.target.value as EntityVisibility }))}>
              <option value="public">Public</option>
              <option value="members">Members</option>
              <option value="private">Private</option>
            </select>
          </label>
          <button className="primary big" disabled={busy || !orgForm.name.trim() || !orgForm.shortName.trim() || !orgForm.region.trim()} onClick={() => run(async () => {
            await createSubordinateOrganization(organizationId, orgForm);
            setOrgForm({ name: '', shortName: '', region: '', kind: 'local_organization', visibility: 'members' });
          }, 'Subordinate organization created with you as its initial administrator.')}>Create Subordinate Organization</button>
        </div> : <div className="state-card">Organization administrator access is required to create subordinate organizations.</div>}

        <div className="membership-list">
          {snapshot.organizations.map(org => <article key={org.id}>
            <div className="grow">
              <strong>{org.name}</strong>
              <small>{org.shortName} · {label(org.kind || 'independent_organization')} · {org.region}</small>
            </div>
          </article>)}
        </div>

        {organizationAdmin && snapshot.organizations.length > 1 && <div className="form-stack">
          <h3>Relate existing organizations</h3>
          <label>Parent
            <select value={relationshipForm.parentId} onChange={e => setRelationshipForm(form => ({ ...form, parentId: e.target.value }))}>
              <option value="">Choose parent</option>
              {snapshot.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
          </label>
          <label>Child
            <select value={relationshipForm.childId} onChange={e => setRelationshipForm(form => ({ ...form, childId: e.target.value }))}>
              <option value="">Choose child</option>
              {snapshot.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
          </label>
          <label>Relationship
            <select value={relationshipForm.kind} onChange={e => setRelationshipForm(form => ({ ...form, kind: e.target.value as 'governs' | 'recognizes' | 'affiliate' }))}>
              <option value="governs">Governs</option>
              <option value="recognizes">Recognizes</option>
              <option value="affiliate">Affiliate</option>
            </select>
          </label>
          <button disabled={busy || !relationshipForm.parentId || !relationshipForm.childId || relationshipForm.parentId === relationshipForm.childId} onClick={() => run(
            () => createOrganizationRelationship(organizationId, relationshipForm.parentId, relationshipForm.childId, relationshipForm.kind).then(() => undefined),
            'Organization relationship created.'
          )}>Add Relationship</button>
        </div>}

        <div className="membership-list">
          {relationshipRows.length === 0 ? <div className="state-card">No active hierarchy relationships are visible yet.</div> : relationshipRows.map(row => {
            const parent = snapshot.organizations.find(org => org.id === row.parentOrganizationId);
            const child = snapshot.organizations.find(org => org.id === row.childOrganizationId);
            return <article key={row.id}>
              <div className="grow">
                <strong>{parent?.shortName || 'Organization'} → {child?.shortName || 'Organization'}</strong>
                <small>{label(row.relationshipKind)} · since {row.startsOn}</small>
              </div>
              {(organizationAdmin || platformAdmin) && <button disabled={busy} onClick={() => run(
                () => endOrganizationRelationship(organizationId, row.id),
                'Organization relationship ended without deleting history.'
              )}>End</button>}
            </article>;
          })}
        </div>
      </section>

      <section className="panel-card">
        <h2>Clubs</h2>
        <p>Clubs are durable homes inside an organization. Archiving keeps history and detaches active teams safely.</p>
        {organizationAdmin && <div className="form-stack">
          <input value={clubForm.name} onChange={e => setClubForm(form => ({ ...form, name: e.target.value }))} placeholder="Club name"/>
          <input value={clubForm.shortName} onChange={e => setClubForm(form => ({ ...form, shortName: e.target.value }))} placeholder="Short name"/>
          <input value={clubForm.region} onChange={e => setClubForm(form => ({ ...form, region: e.target.value }))} placeholder="Region"/>
          <textarea value={clubForm.description} onChange={e => setClubForm(form => ({ ...form, description: e.target.value }))} placeholder="Public description"/>
          <input value={clubForm.websiteUrl} onChange={e => setClubForm(form => ({ ...form, websiteUrl: e.target.value }))} placeholder="Website URL"/>
          <label>Visibility
            <select value={clubForm.visibility} onChange={e => setClubForm(form => ({ ...form, visibility: e.target.value as EntityVisibility }))}>
              <option value="public">Public</option>
              <option value="members">Members</option>
              <option value="private">Private</option>
            </select>
          </label>
          <button disabled={busy || !clubForm.name.trim()} onClick={saveClub}>{editingClubId ? 'Save Club' : 'Create Club'}</button>
          {editingClubId && <button disabled={busy} onClick={() => {
            setEditingClubId('');
            setClubForm({ name: '', shortName: '', region: '', visibility: 'members', description: '', websiteUrl: '' });
          }}>Cancel Edit</button>}
        </div>}

        <div className="membership-list">
          {snapshot.clubs.length === 0 ? <div className="state-card">No clubs are visible in this organization yet.</div> : snapshot.clubs.map(club => <article key={club.id}>
            <div className="grow">
              <strong>{club.name}</strong>
              <small>{[club.shortName, club.region, label(club.visibility || 'members')].filter(Boolean).join(' · ')}</small>
            </div>
            <div className="header-actions">
              {canManageClub(club.id) && <button disabled={busy} onClick={() => editClub(club)}>Edit</button>}
              {organizationAdmin && <button disabled={busy} onClick={() => {
                if (!window.confirm('Archive ' + club.name + '? Membership and sporting history will be preserved.')) return;
                run(() => archiveGovernanceClub(organizationId, club.id), 'Club archived without deleting history.');
              }}>Archive</button>}
            </div>
          </article>)}
        </div>
      </section>

      <section className="panel-card">
        <h2>Teams</h2>
        <p>Teams may live directly under the organization or inside a club. Club-created teams enter pending status until organization approval.</p>
        {(organizationAdmin || user.clubRoles.some(role => role.role === 'club_admin')) && <div className="form-stack">
          <input value={teamForm.name} onChange={e => setTeamForm(form => ({ ...form, name: e.target.value }))} placeholder="Team name"/>
          <input value={teamForm.shortName} onChange={e => setTeamForm(form => ({ ...form, shortName: e.target.value }))} placeholder="Short name"/>
          <input value={teamForm.region} onChange={e => setTeamForm(form => ({ ...form, region: e.target.value }))} placeholder="City or region"/>
          <label>Club
            <select value={teamForm.clubId} onChange={e => setTeamForm(form => ({ ...form, clubId: e.target.value }))}>
              <option value="">Direct organization team</option>
              {snapshot.clubs.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}
            </select>
          </label>
          <textarea value={teamForm.description} onChange={e => setTeamForm(form => ({ ...form, description: e.target.value }))} placeholder="Public description"/>
          <label>Visibility
            <select value={teamForm.visibility} onChange={e => setTeamForm(form => ({ ...form, visibility: e.target.value as EntityVisibility }))}>
              <option value="public">Public</option>
              <option value="members">Members</option>
              <option value="private">Private</option>
            </select>
          </label>
          <button disabled={busy || !teamForm.name.trim()} onClick={saveTeam}>{editingTeamId ? 'Save Team' : 'Create Team'}</button>
          {editingTeamId && <button disabled={busy} onClick={() => {
            setEditingTeamId('');
            setTeamForm({ name: '', shortName: '', region: '', clubId: '', visibility: 'members', description: '' });
          }}>Cancel Edit</button>}
        </div>}

        <div className="membership-list">
          {snapshot.teams.length === 0 ? <div className="state-card">No teams are visible in this organization yet.</div> : snapshot.teams.map(team => {
            const authority = teamAuthority(team);
            const canEdit = canManageTeam(team);
            const canArchive = organizationAdmin || authority.clubAdmin;
            return <article key={team.id}>
              <div className="grow">
                <strong>{team.name}</strong>
                <small>{[
                  team.clubId ? snapshot.clubs.find(club => club.id === team.clubId)?.name : 'Direct organization team',
                  team.cityOrRegion,
                  label(team.status || 'active')
                ].filter(Boolean).join(' · ')}</small>
              </div>
              <div className="header-actions">
                {organizationAdmin && <select aria-label={'Status for ' + team.name} disabled={busy} value={team.status || 'active'} onChange={e => run(
                  () => setGovernanceTeamStatus(organizationId, team.id, e.target.value as TeamStatus),
                  'Team status updated.'
                )}>
                  {teamStatuses.map(status => <option key={status} value={status}>{label(status)}</option>)}
                </select>}
                {canEdit && <button disabled={busy} onClick={() => editTeam(team)}>Edit</button>}
                {canArchive && <button disabled={busy} onClick={() => {
                  if (!window.confirm('Archive ' + team.name + '? Membership and sporting history will be preserved.')) return;
                  run(() => archiveGovernanceTeam(organizationId, team.id), 'Team archived without deleting history.');
                }}>Archive</button>}
              </div>
            </article>;
          })}
        </div>
      </section>

      <section className="panel-card">
        <h2>Invitations & applications</h2>
        <p>Invitations expire after 14 days, are tied to the recipient email, and are rechecked against the issuer's current authority when accepted.</p>
        <div className="form-stack">
          <label>Invite to
            <select value={inviteForm.scope} onChange={e => setInviteForm(form => ({ ...form, scope: e.target.value as MembershipScope, targetId: '', role: e.target.value === 'club' ? 'member' : 'fighter' }))}>
              <option value="team">Team</option>
              <option value="club">Club</option>
            </select>
          </label>
          <label>Target
            <select value={inviteForm.targetId} onChange={e => setInviteForm(form => ({ ...form, targetId: e.target.value }))}>
              <option value="">Choose target</option>
              {(inviteForm.scope === 'club' ? snapshot.clubs : snapshot.teams).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label>Role
            <select value={inviteRoles.includes(inviteForm.role) ? inviteForm.role : inviteRoles[0] || ''} onChange={e => setInviteForm(form => ({ ...form, role: e.target.value as ClubRole | TeamRole }))}>
              {inviteRoles.map(role => <option key={role} value={role}>{label(role)}</option>)}
            </select>
          </label>
          <input type="email" value={inviteForm.email} onChange={e => setInviteForm(form => ({ ...form, email: e.target.value }))} placeholder="person@example.com"/>
          <textarea value={inviteForm.message} onChange={e => setInviteForm(form => ({ ...form, message: e.target.value }))} placeholder="Optional invitation note"/>
          <button disabled={busy || !inviteForm.targetId || !inviteForm.email.trim() || inviteRoles.length === 0} onClick={createInvite}>Create Invitation</button>
          {inviteLink && <div className="state-card"><strong>Share this secure invitation link</strong><br/><code>{inviteLink}</code></div>}
        </div>

        <div className="form-stack">
          <h3>Apply to join</h3>
          <label>Membership
            <select value={applicationForm.scope} onChange={e => setApplicationForm(form => ({ ...form, scope: e.target.value as MembershipScope, targetId: '', role: e.target.value === 'club' ? 'member' : 'fighter' }))}>
              <option value="team">Team</option>
              <option value="club">Club</option>
            </select>
          </label>
          <label>Target
            <select value={applicationForm.targetId} onChange={e => setApplicationForm(form => ({ ...form, targetId: e.target.value }))}>
              <option value="">Choose target</option>
              {(applicationForm.scope === 'club' ? snapshot.clubs : snapshot.teams.filter(team => team.status === 'active')).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          {applicationForm.scope === 'team' && <label>Role
            <select value={applicationForm.role} onChange={e => setApplicationForm(form => ({ ...form, role: e.target.value as TeamRole }))}>
              <option value="fighter">Fighter</option>
              <option value="support">Support</option>
            </select>
          </label>}
          <textarea value={applicationForm.message} onChange={e => setApplicationForm(form => ({ ...form, message: e.target.value }))} placeholder="Optional application note"/>
          <button disabled={busy || !applicationForm.targetId} onClick={apply}>Submit Application</button>
        </div>

        <div className="membership-list">
          {pendingRequests.length === 0 ? <div className="state-card">No pending invitations or applications are visible.</div> : pendingRequests.map(request => {
            const target = request.scope === 'club'
              ? snapshot.clubs.find(row => row.id === request.clubId)
              : snapshot.teams.find(row => row.id === request.teamId);
            const role = request.requestedClubRole || request.requestedTeamRole || 'member';
            const manager = canManageRequest(request);
            const own = request.requesterUserId === user.userId || request.createdBy === user.userId;
            return <article key={request.id}>
              <div className="grow">
                <strong>{request.requestKind === 'invitation' ? request.inviteEmail : 'Membership application'}</strong>
                <small>{target?.name || 'Target'} · {label(role)}{request.expiresAt ? ' · expires ' + new Date(request.expiresAt).toLocaleDateString() : ''}</small>
              </div>
              <div className="header-actions">
                {request.requestKind === 'application' && manager && <button disabled={busy} onClick={() => run(
                  () => reviewMembershipApplication(organizationId, request.id, 'accept'),
                  'Membership application accepted.'
                )}>Accept</button>}
                {request.requestKind === 'application' && manager && <button disabled={busy} onClick={() => run(
                  () => reviewMembershipApplication(organizationId, request.id, 'reject'),
                  'Membership application rejected.'
                )}>Reject</button>}
                {(manager || own) && <button disabled={busy} onClick={() => run(
                  () => cancelMembershipRequest(organizationId, request.id),
                  'Pending request cancelled.'
                )}>Cancel</button>}
              </div>
            </article>;
          })}
        </div>
      </section>

      <section className="panel-card">
        <h2>Active membership roster</h2>
        <p>Leadership and membership periods are ended rather than deleted, preserving a durable roster history.</p>

        <h3>Club memberships</h3>
        <div className="membership-list">
          {snapshot.clubMemberships.length === 0 ? <div className="state-card">No active club memberships are visible.</div> : snapshot.clubMemberships.map(membership => {
            const club = snapshot.clubs.find(row => row.id === membership.clubId);
            const authority = clubAuthority(membership.clubId);
            const roles = allowedInviteRoles('club', authority) as ClubRole[];
            const canEdit = canManageClub(membership.clubId) && membership.userId !== user.userId;
            return <article key={membership.id}>
              <div className="grow">
                <strong>{membership.displayName}</strong>
                <small>{club?.name || 'Club'} · {label(membership.role)} · since {membership.startsOn}</small>
              </div>
              <div className="header-actions">
                {canEdit && roles.length > 0 && <select aria-label={'Role for ' + membership.displayName} disabled={busy} value={membership.role} onChange={e => run(
                  () => changeMembershipRole(organizationId, 'club', membership.id, e.target.value as ClubRole),
                  'Club role changed and the prior role period was preserved.'
                )}>
                  {[...new Set([membership.role, ...roles])].map(role => <option key={role} value={role}>{label(role)}</option>)}
                </select>}
                {(membership.userId === user.userId || canManageClub(membership.clubId)) && <button disabled={busy} onClick={() => run(
                  () => endMembership(organizationId, 'club', membership.id),
                  'Club membership ended and retained in history.'
                )}>End</button>}
              </div>
            </article>;
          })}
        </div>

        <h3>Team memberships</h3>
        <div className="membership-list">
          {snapshot.teamMemberships.length === 0 ? <div className="state-card">No active team memberships are visible.</div> : snapshot.teamMemberships.map(membership => {
            const team = snapshot.teams.find(row => row.id === membership.teamId);
            const authority = teamAuthority(team || { id: membership.teamId, organizationId, name: '' });
            const roles = allowedInviteRoles('team', authority) as TeamRole[];
            const canEdit = Boolean(team && canManageTeam(team) && membership.userId !== user.userId);
            return <article key={membership.id}>
              <div className="grow">
                <strong>{membership.displayName}</strong>
                <small>{team?.name || 'Team'} · {label(membership.role)} · since {membership.startsOn}</small>
              </div>
              <div className="header-actions">
                {canEdit && roles.length > 0 && <select aria-label={'Role for ' + membership.displayName} disabled={busy} value={membership.role} onChange={e => run(
                  () => changeMembershipRole(organizationId, 'team', membership.id, e.target.value as TeamRole),
                  'Team role changed and the prior role period was preserved.'
                )}>
                  {[...new Set([membership.role, ...roles])].map(role => <option key={role} value={role}>{label(role)}</option>)}
                </select>}
                {(membership.userId === user.userId || Boolean(team && canManageTeam(team))) && <button disabled={busy} onClick={() => run(
                  () => endMembership(organizationId, 'team', membership.id),
                  'Team membership ended and retained in history.'
                )}>End</button>}
              </div>
            </article>;
          })}
        </div>
      </section>
    </div>
  </>;
}
