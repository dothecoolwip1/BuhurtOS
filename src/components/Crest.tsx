import { useId } from 'react';
import type { Team } from '../data/types';

const SHIELD = 'M4 3h56v28c0 19-14 32-28 38C18 63 4 50 4 31Z';

function Division({ team }: { team: Team }) {
  const b = team.colors[1];
  switch (team.division) {
    case 'pale': return <rect x="32" y="0" width="32" height="72" fill={b} />;
    case 'fess': return <rect x="0" y="24" width="64" height="18" fill={b} />;
    case 'bend': return <path d="M0 6 10 0 64 54 64 66Z" fill={b} />;
    case 'chevron': return <path d="M0 54 32 22 64 54 64 70 32 38 0 70Z" fill={b} />;
    case 'quarterly': return <><rect x="32" y="0" width="32" height="34" fill={b} /><rect x="0" y="34" width="32" height="40" fill={b} /></>;
    case 'saltire': return <path d="M-4 4 4 -4 68 60 60 68ZM60 -4 68 4 4 68 -4 60Z" fill={b} />;
  }
}

/** Generated heraldic shield: with the team's own emblem in the middle when it has uploaded one, else its initial. */
export function Crest({ team, size = 44 }: { team: Team; size?: number }) {
  const uid = useId().replace(/:/g, '');
  const [a, b] = team.colors;
  const light = (a === '#E9ECEF' || a === '#D4A63A') && team.division !== 'pale';
  const letter = light ? '#fff' : a === '#E9ECEF' ? b : a;
  return (
    <svg className="crest" width={size} height={Math.round(size * 1.12)} viewBox="0 0 64 72" role="img" aria-label={`${team.name} crest`}>
      <defs>
        <clipPath id={`c${uid}`}><path d={SHIELD} /></clipPath>
        <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".18" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#c${uid})`}>
        <rect width="64" height="72" fill={a} />
        <Division team={team} />
        {team.emblemUrl ? (
          <>
            <circle cx="32" cy="32" r="16" fill="#fff" opacity=".94" />
            <image href={team.emblemUrl} x="18" y="18" width="28" height="28" preserveAspectRatio="xMidYMid meet" />
          </>
        ) : (
          <>
            <circle cx="32" cy="32" r="13" fill={light ? '#1A1D22' : '#fff'} opacity=".94" />
            <text x="32" y="38.5" textAnchor="middle" fontFamily="Big Shoulders Display,Impact,sans-serif" fontWeight={900} fontSize="18" fill={letter}>{team.initial}</text>
          </>
        )}
        <rect width="64" height="72" fill={`url(#g${uid})`} />
      </g>
      <path d={SHIELD} fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.5" />
    </svg>
  );
}
