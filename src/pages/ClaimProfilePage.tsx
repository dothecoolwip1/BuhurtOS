import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { ClaimRequest } from '../components/ClaimRequest';
import { Chip, PageHead } from '../components/ui';
import { cancelFighterClaim, fetchMyClaims, searchUnclaimedFighters, type UnclaimedFighter } from '../data/claims';
import { fetchMyFighterId } from '../data/fighters';
import { claimStatusText, historyLine } from '../lib/claims';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function ClaimProfilePage() {
  useDocumentTitle('Claim your fighter profile');
  const { session, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18 }}>
      <PageHead eyebrow="Account" title="Claim your fighter profile" lede="Already have fight history in BuhurtOS? Find and claim your fighter profile. Your matches, results and team history stay on that profile." />
      {session ? <Claim userId={session.user.id} /> : <><p>Sign in first, then find your profile.</p><SignIn /></>}
    </section>
  );
}

function Claim({ userId }: { userId: string }) {
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [found, setFound] = useState<UnclaimedFighter[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const [justSent, setJustSent] = useState<string[]>([]);
  const mine = useAsync(() => fetchMyClaims(), [userId, key]);
  const own = useAsync(() => fetchMyFighterId(), [userId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setFound([]); setSearched(false); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchUnclaimedFighters(q).then(r => { if (live) { setFound(r); setSearched(true); setSearching(false); setError(null); } },
        e => { if (live) { setError(friendlyError(e, 'Search failed.')); setSearching(false); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  const waiting = new Set((mine.data ?? []).filter(c => c.status === 'pending').map(c => c.fighterId));
  const cancel = async (id: string) => {
    try { await cancelFighterClaim(id); setKey(k => k + 1); } catch (e) { setError(friendlyError(e, 'Could not cancel the request.')); }
  };

  return (
    <>
      {own.data && <p className="panel info" role="note">You already have a fighter profile. If you believe a second profile is also you, ask below: an administrator checks it. Nothing is merged or replaced automatically.</p>}
      <label className="field-in">Search by your name, team or city
        <input type="search" inputMode="search" autoComplete="off" value={query} onChange={e => setQuery(e.target.value)} data-testid="claim-search" placeholder="For example: Zed Newcomer" />
      </label>
      <p className="src">A matching name only helps you find a candidate. An administrator confirms it is really you before anything is linked.</p>
      {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
      {searching && <p className="src">Searching…</p>}
      {found.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }} data-testid="claim-results">
          {found.map(f => (
            <li key={f.fighterId} className="panel" style={{ display: 'grid', gap: 8, padding: 14 }}>
              <div style={{ overflowWrap: 'anywhere' }}><b>{f.name}</b> <Chip>Unclaimed profile</Chip></div>
              <span className="src">{[f.team, [f.city, f.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'No team or location on record'}</span>
              <span className="src">{historyLine(f)}</span>
              {waiting.has(f.fighterId) && !justSent.includes(f.fighterId)
                ? <Chip tone="brass">Request waiting</Chip>
                : <ClaimRequest fighterId={f.fighterId} name={f.name} hasOwnProfile={!!own.data} onSent={() => { setJustSent(j => [...j, f.fighterId]); setKey(k => k + 1); }} />}
            </li>
          ))}
        </ul>
      )}
      {searched && !searching && found.length === 0 && query.trim().length >= 2 && <p className="muted">No unclaimed profile matches “{query.trim()}”. If you have fought before, try your team or city, or ask the organizer to add you.</p>}

      {(mine.data?.length ?? 0) > 0 && (
        <section aria-labelledby="my-claims" style={{ display: 'grid', gap: 10 }}>
          <h2 id="my-claims" className="acct-h">Your requests</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {mine.data!.map(c => (
              <li key={c.requestId} className="panel" style={{ display: 'grid', gap: 6, padding: 14 }}>
                <b>{c.fighterName}</b>
                <span className="src">{c.team ? `${c.team} · ` : ''}{claimStatusText(c)}</span>
                {c.status === 'pending' && <div><button type="button" className="btn btn-line btn-sm" onClick={() => void cancel(c.requestId)}>Cancel request</button></div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
