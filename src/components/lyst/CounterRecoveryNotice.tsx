/** Keep recovery visible without pushing the tally and count buttons off a phone screen. */
export function CounterRecoveryNotice({ savedNotice, backlog, manualRound, cachedAt }: {
  savedNotice: string | null; backlog: string | null; manualRound?: number; cachedAt?: string;
}) {
  if (!savedNotice && !backlog && !manualRound && !cachedAt) return null;
  return (
    <details className="cp-recovery-notice">
      <summary>{manualRound ? `Round ${manualRound} · counts need marshal review` : cachedAt ? 'Saved fight · check with marshal' : 'Saved counts need attention'} <span>Details</span></summary>
      <div>
        {manualRound && <p>Counting round {manualRound} from the marshal’s call. This is provisional evidence for review. It cannot change an official score.</p>}
        {cachedAt && <p>Saved fight from {cachedAt}. Check the names, side and round with the marshal before counting offline.</p>}
        {savedNotice && <p>{savedNotice}</p>}
        {backlog && <p>{backlog}</p>}
        <p>Open Saved counter evidence below to show the marshal.</p>
      </div>
    </details>
  );
}
