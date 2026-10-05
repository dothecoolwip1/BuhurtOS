import { useEffect, useState } from 'react';
import { fetchMatchReadiness } from '../data/readiness';
import { matchWarnings } from '../lib/readiness';

const REFRESH_MS = 30_000;

/**
 * Pack 16: a warning above the scoring screen when a fighter in this fight is not ready (not checked in, armour not passed, …).
 * It is only a warning. It never blocks, reorders or changes the fight; the queue does not read it. If it cannot load, it shows nothing.
 */
export function ReadinessStrip({ matchId }: { matchId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => { void fetchMatchReadiness(matchId).then(s => { if (live) setLines(matchWarnings(s)); }).catch(() => { /* a warning that cannot load is not shown; it never gets in the way */ }); };
    load();
    const t = window.setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    window.addEventListener('online', load);
    return () => { live = false; window.clearInterval(t); window.removeEventListener('online', load); };
  }, [matchId]);
  if (lines.length === 0) return null;
  return (
    <div className="ready-strip" role="status" data-testid="readiness-strip">
      <b>⚠ Not ready</b>
      {lines.slice(0, 6).map(l => <span key={l}>{l}</span>)}
      {lines.length > 6 && <span>and {lines.length - 6} more</span>}
      <span className="src">A warning only: the fight is not held back. The check-in desk can clear it.</span>
    </div>
  );
}
