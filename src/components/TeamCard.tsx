import type { Team } from '../data/types';
import { Crest } from './Crest';
import { Chip } from './ui';

export function TeamCard({ team }: { team: Team }) {
  return (
    <div className="panel teamcard">
      <Crest team={team} size={48} />
      <div style={{ minWidth: 0 }}>
        <div className="n">{team.name}</div>
        <div className="l">{team.place}</div>
        <div className="s"><Chip>{team.record[0]}–{team.record[1]}</Chip><Chip tone="steel">{team.points} pts</Chip></div>
      </div>
    </div>
  );
}
