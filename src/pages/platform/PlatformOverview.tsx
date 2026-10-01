import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHead } from '../../components/ui';
import { fetchAdminOrganizations } from '../../data/organizations';
import { fetchAllAdminFighters, fetchAllAdminTeams } from '../../data/platformAdmin';
import { friendlyError } from '../../lib/friendlyError';
import { overviewCounts, type OverviewCounts } from '../../lib/platformAdmin';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PlatformGate } from './PlatformPages';
import { PlatformNav } from './parts';

export function PlatformHomePage() {
  useDocumentTitle('Platform');
  return <PlatformGate><Overview /></PlatformGate>;
}

function Overview() {
  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([fetchAllAdminTeams(null), fetchAllAdminFighters(null, null), fetchAdminOrganizations()]).then(([t, f, o]) => {
      if (!live) return;
      setCounts(overviewCounts(t.rows, t.total, f.rows, f.total, o.length));
      setPartial(t.capped || f.capped); setError(null);
    }, e => { if (live) setError(friendlyError(e)); });
    return () => { live = false; };
  }, [tick]);

  const stat = (n: number | undefined, label: string, to: string) => (
    <Link className="panel plat-stat" to={to}><b>{n ?? '–'}</b><span>{label}</span></Link>
  );
  return (
    <section className="plat" style={{ display: 'grid', gap: 18 }}>
      <PageHead eyebrow="Platform" title="Platform" lede="Owner tools. Every action is checked by the database again; this page only decides what is shown." />
      <PlatformNav />
      {error && <p role="alert" className="plat-err">{error} <button type="button" className="linklike" onClick={() => setTick(t => t + 1)}>Try again</button></p>}
      {!counts && !error && <p className="muted">Loading counts…</p>}
      <div className="plat-stats">
        {stat(counts?.teams, 'Teams', '/platform/teams')}
        {stat(counts?.pendingTeams, 'Teams awaiting approval', '/platform/teams?status=pending')}
        {stat(counts?.fighters, 'Fighters', '/platform/fighters')}
        {stat(counts?.unclaimedFighters, 'Unclaimed fighters', '/platform/fighters?unclaimed=1')}
        {stat(counts?.organizations, 'Organizations', '/platform/organizations')}
      </div>
      {partial && <p className="muted" style={{ fontSize: 13 }}>Unclaimed and pending counts cover the first 2000 records of each list.</p>}
      <ul className="plain">
        <li><Link className="panel plat-link" to="/platform/teams?status=pending"><b>Pending team queue</b><span className="muted">Teams waiting for approval.</span></Link></li>
        <li><Link className="panel plat-link" to="/platform/teams"><b>Teams</b><span className="muted">Find, edit, approve and merge any team.</span></Link></li>
        <li><Link className="panel plat-link" to="/platform/fighters"><b>Fighters</b><span className="muted">Find, edit, move and merge any fighter. Medical and emergency details are never shown.</span></Link></li>
        <li><Link className="panel plat-link" to="/platform/organizations"><b>Organizations</b><span className="muted">Switch organizations on or off and manage their admins.</span></Link></li>
      </ul>
    </section>
  );
}
