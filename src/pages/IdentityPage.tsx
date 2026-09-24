import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import {
  cancelFighterIdentityClaim,
  createMyFighterIdentity,
  disputeFighterIdentityClaim,
  listMyFighterIdentities,
  listMyIdentityClaims,
  loadFighterPrivateProfile,
  searchClaimableFighterIdentities,
  submitFighterIdentityClaim,
  updateFighterPrivateProfile,
  updateFighterPublicProfile
} from '../lib/fighterIdentity';
import type {
  FighterIdentity,
  FighterIdentityClaim,
  FighterIdentityPrivateProfile,
  FighterIdentitySearchResult,
  FighterProfileVisibility,
  IdentityAccountRole
} from '../types';

const emptyPrivate = (): FighterIdentityPrivateProfile => ({
  identityId: '',
  revision: 0
});

export function IdentityPage() {
  const { user } = useAppState();
  const [identities, setIdentities] = useState<FighterIdentity[]>([]);
  const [claims, setClaims] = useState<FighterIdentityClaim[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [createName, setCreateName] = useState('');
  const [publicForm, setPublicForm] = useState({
    displayName: '',
    nickname: '',
    bio: '',
    publicRegion: '',
    profileVisibility: 'private' as FighterProfileVisibility
  });
  const [privateForm, setPrivateForm] = useState<FighterIdentityPrivateProfile>(emptyPrivate());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FighterIdentitySearchResult[]>([]);
  const [claimRelationship, setClaimRelationship] = useState<IdentityAccountRole>('self');
  const [claimNote, setClaimNote] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => identities.find(row => row.id === selectedId) || null, [identities, selectedId]);

  const refresh = async (preferredId?: string) => {
    if (!user) return;
    const [identityRows, claimRows] = await Promise.all([
      listMyFighterIdentities(user.userId),
      listMyIdentityClaims(user.userId)
    ]);
    setIdentities(identityRows);
    setClaims(claimRows);
    const nextId = preferredId || selectedId || identityRows[0]?.id || '';
    setSelectedId(identityRows.some(row => row.id === nextId) ? nextId : identityRows[0]?.id || '');
  };

  useEffect(() => {
    refresh().catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load fighter identities.'));
  }, [user?.userId]);

  useEffect(() => {
    if (!selected) {
      setPublicForm({ displayName: '', nickname: '', bio: '', publicRegion: '', profileVisibility: 'private' });
      setPrivateForm(emptyPrivate());
      return;
    }
    setPublicForm({
      displayName: selected.displayName,
      nickname: selected.nickname || '',
      bio: selected.bio || '',
      publicRegion: selected.publicRegion || '',
      profileVisibility: selected.profileVisibility
    });
    loadFighterPrivateProfile(selected.id)
      .then(row => setPrivateForm(row || { ...emptyPrivate(), identityId: selected.id }))
      .catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load private fighter information.'));
  }, [selected?.id, selected?.profileRevision]);

  if (!user) return <div className="state-card">Sign in to manage your fighter identity.</div>;

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The requested identity change could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const createIdentity = () => run(async () => {
    const id = await createMyFighterIdentity(createName);
    setCreateName('');
    await refresh(id);
  }, 'Permanent fighter identity created. Its ID will not change when teams or account details change.');

  const savePublic = () => {
    if (!selected) return;
    return run(async () => {
      await updateFighterPublicProfile({
        identity: selected,
        ...publicForm
      });
      await refresh(selected.id);
    }, 'Public fighter profile saved.');
  };

  const savePrivate = () => {
    if (!selected) return;
    return run(async () => {
      await updateFighterPrivateProfile({
        identityId: selected.id,
        expectedRevision: privateForm.revision,
        legalName: privateForm.legalName,
        birthDate: privateForm.birthDate,
        contactEmail: privateForm.contactEmail,
        phone: privateForm.phone,
        emergencyContactName: privateForm.emergencyContactName,
        emergencyContactPhone: privateForm.emergencyContactPhone,
        guardianName: privateForm.guardianName,
        guardianEmail: privateForm.guardianEmail,
        guardianPhone: privateForm.guardianPhone,
        guardianConsent: null
      });
      const reloaded = await loadFighterPrivateProfile(selected.id);
      setPrivateForm(reloaded || { ...emptyPrivate(), identityId: selected.id });
    }, 'Private fighter information saved. It is not part of the public sports profile.');
  };

  const search = () => run(async () => {
    setSearchResults(await searchClaimableFighterIdentities(searchQuery));
  }, 'Identity search complete.');

  const claim = (result: FighterIdentitySearchResult) => run(async () => {
    await submitFighterIdentityClaim(result.identityId, claimRelationship, claimNote);
    setClaimNote('');
    await refresh();
  }, result.isClaimed && claimRelationship === 'self'
    ? 'Claim submitted as a dispute because another account currently controls this identity.'
    : 'Identity claim submitted for review.');

  const cancelClaim = (claimRow: FighterIdentityClaim) => run(async () => {
    await cancelFighterIdentityClaim(claimRow);
    await refresh();
  }, 'Identity claim cancelled.');

  const disputeClaim = (claimRow: FighterIdentityClaim) => {
    const reason = window.prompt('Why should this claim be reviewed again?')?.trim();
    if (!reason) return;
    return run(async () => {
      await disputeFighterIdentityClaim(claimRow, reason);
      await refresh();
    }, 'Claim moved to dispute review.');
  };

  return <>
    <section className="section-head">
      <div>
        <span className="eyebrow">Permanent fighter record</span>
        <h1>My Fighter Identity</h1>
        <p>Your fighter ID is independent from your login, display name, team and organization. Public sports details and private administrative information are stored separately.</p>
      </div>
    </section>

    <div className="admin-grid">
      <section className="panel-card">
        <h2>My identities</h2>
        <p>Create a new identity only when you do not already have a historical fighter record to claim.</p>
        <div className="form-stack">
          {identities.length > 0 && <label>Identity
            <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
              {identities.map(identity => <option key={identity.id} value={identity.id}>{identity.displayName}</option>)}
            </select>
          </label>}
          <input value={createName} onChange={event => setCreateName(event.target.value)} placeholder="New fighter display name"/>
          <button disabled={busy || createName.trim().length < 2} onClick={createIdentity}>Create Permanent Identity</button>
        </div>
        {selected && <div className="state-card">
          <strong>Stable fighter ID</strong>
          <small>{selected.id}</small>
          <small>{selected.verifiedAt ? 'Verified account ownership' : 'Account linked, verification may still be pending'}</small>
        </div>}
      </section>

      <section className="panel-card">
        <h2>Public fighter profile</h2>
        <p>Only fields in this section can be exposed as sporting profile information. Privacy is enforced by the database, not by hiding fields in the browser.</p>
        {!selected ? <div className="state-card">Create or claim an identity to edit your profile.</div> : <div className="form-stack">
          <label>Display name<input value={publicForm.displayName} onChange={event => setPublicForm(form => ({ ...form, displayName: event.target.value }))}/></label>
          <label>Nickname<input value={publicForm.nickname} onChange={event => setPublicForm(form => ({ ...form, nickname: event.target.value }))}/></label>
          <label>Public region<input value={publicForm.publicRegion} onChange={event => setPublicForm(form => ({ ...form, publicRegion: event.target.value }))}/></label>
          <label>Visibility<select value={publicForm.profileVisibility} onChange={event => setPublicForm(form => ({ ...form, profileVisibility: event.target.value as FighterProfileVisibility }))}>
            <option value="private">Private</option>
            <option value="members">Signed in members</option>
            <option value="public">Public</option>
          </select></label>
          <label>Bio<textarea rows={5} value={publicForm.bio} onChange={event => setPublicForm(form => ({ ...form, bio: event.target.value }))}/></label>
          <button className="primary big" disabled={busy} onClick={savePublic}>Save Public Profile</button>
          <small>Revision {selected.profileRevision}. If another device changes this profile first, your save is rejected instead of overwriting it.</small>
        </div>}
      </section>

      <section className="panel-card">
        <h2>Private administrative details</h2>
        <p>Legal name, birth date, contact details, emergency details and guardian information are never included in the anonymous public profile.</p>
        {!selected ? <div className="state-card">No identity selected.</div> : <div className="form-stack">
          <label>Legal name<input value={privateForm.legalName || ''} onChange={event => setPrivateForm(form => ({ ...form, legalName: event.target.value }))}/></label>
          <label>Birth date<input type="date" value={privateForm.birthDate || ''} onChange={event => setPrivateForm(form => ({ ...form, birthDate: event.target.value }))}/></label>
          <label>Contact email<input type="email" value={privateForm.contactEmail || ''} onChange={event => setPrivateForm(form => ({ ...form, contactEmail: event.target.value }))}/></label>
          <label>Phone<input value={privateForm.phone || ''} onChange={event => setPrivateForm(form => ({ ...form, phone: event.target.value }))}/></label>
          <label>Emergency contact<input value={privateForm.emergencyContactName || ''} onChange={event => setPrivateForm(form => ({ ...form, emergencyContactName: event.target.value }))}/></label>
          <label>Emergency phone<input value={privateForm.emergencyContactPhone || ''} onChange={event => setPrivateForm(form => ({ ...form, emergencyContactPhone: event.target.value }))}/></label>
          <label>Guardian name<input value={privateForm.guardianName || ''} onChange={event => setPrivateForm(form => ({ ...form, guardianName: event.target.value }))}/></label>
          <label>Guardian email<input type="email" value={privateForm.guardianEmail || ''} onChange={event => setPrivateForm(form => ({ ...form, guardianEmail: event.target.value }))}/></label>
          <label>Guardian phone<input value={privateForm.guardianPhone || ''} onChange={event => setPrivateForm(form => ({ ...form, guardianPhone: event.target.value }))}/></label>
          <button disabled={busy} onClick={savePrivate}>Save Private Details</button>
          {privateForm.guardianConsentAt && <small>Guardian consent recorded {new Date(privateForm.guardianConsentAt).toLocaleDateString()}.</small>}
        </div>}
      </section>

      <section className="panel-card">
        <h2>Claim an existing fighter record</h2>
        <p>Search historical records before creating a duplicate. A claim never silently takes a fighter record away from another account.</p>
        <div className="form-stack">
          <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search fighter name or known alias"/>
          <label>Claim relationship<select value={claimRelationship} onChange={event => setClaimRelationship(event.target.value as IdentityAccountRole)}>
            <option value="self">This is me</option>
            <option value="guardian">I am the guardian</option>
          </select></label>
          <textarea rows={3} value={claimNote} onChange={event => setClaimNote(event.target.value)} placeholder="Optional note for the reviewer"/>
          <button disabled={busy || searchQuery.trim().length < 3} onClick={search}>Search Existing Identities</button>
        </div>
        <div className="membership-list">
          {searchResults.map(result => <article key={result.identityId}>
            <div className="grow">
              <strong>{result.displayName}</strong>
              <small>{[result.nickname, result.publicRegion].filter(Boolean).join(' · ') || 'No public details'} · {result.isClaimed ? 'currently claimed' : 'unclaimed'}{result.isVerified ? ' · verified' : ''}</small>
            </div>
            <button disabled={busy} onClick={() => claim(result)}>Claim</button>
          </article>)}
        </div>
      </section>

      <section className="panel-card">
        <h2>My claim history</h2>
        <p>Rejected claims can be disputed with a reason. Pending and disputed claims can be cancelled by the claimant.</p>
        <div className="membership-list">
          {claims.length === 0 ? <div className="state-card">No identity claims submitted.</div> : claims.map(claimRow => <article key={claimRow.id}>
            <div className="grow">
              <strong>{claimRow.relationship} claim · {claimRow.status}</strong>
              <small>Identity {claimRow.identityId.slice(0, 8)} · revision {claimRow.version}{claimRow.reviewNote ? ' · ' + claimRow.reviewNote : ''}</small>
            </div>
            <div className="header-actions">
              {claimRow.status === 'rejected' && <button disabled={busy} onClick={() => disputeClaim(claimRow)}>Dispute</button>}
              {(claimRow.status === 'pending' || claimRow.status === 'disputed') && <button disabled={busy} onClick={() => cancelClaim(claimRow)}>Cancel</button>}
            </div>
          </article>)}
        </div>
      </section>
    </div>

    {message && <div className="auth-message">{message}</div>}
  </>;
}
