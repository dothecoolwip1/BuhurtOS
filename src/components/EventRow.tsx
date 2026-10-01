import { Link } from 'react-router-dom';
import type { EventSummary } from '../data/types';
import { Chip, LeagueChips, TierChip } from './ui';

export function EventRow({ e }: { e: EventSummary }) {
  return (
    <Link className="panel eventrow" to={`/events/${e.id}`}>
      <div className="datebox"><span className="m">{e.month}</span><span className="d">{e.day}</span><span className="y">{e.year}</span></div>
      <div style={{ minWidth: 0 }}><h3>{e.name}</h3><div className="meta">{e.meta.map(m => <span key={m}>{m}</span>)}</div></div>
      <div className="tags">
        {e.badges.map(b => <Chip key={b.label} tone={b.tone}>{b.label}</Chip>)}
        {e.tier && <TierChip tier={e.tier} />}
        <LeagueChips leagues={e.leagues} />
      </div>
    </Link>
  );
}
