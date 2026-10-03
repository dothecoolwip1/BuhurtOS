import { useEffect, useRef, type ReactNode } from 'react';
import type { ChipTone, LeagueId } from '../data/types';
import { LEAGUE_NAME } from '../data/types';
import type { TierName } from '../lib/tournament';

export function Chip({ tone = '', children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`chip ${tone}`.trim()}>{children}</span>;
}

export function TierChip({ tier }: { tier: string }) {
  const tone: ChipTone = ({ Classic: 'steel', Regional: 'brass', Conference: 'brass', Source: 'win' } as Record<string, ChipTone>)[tier] ?? '';
  return <Chip tone={tone}>{tier}</Chip>;
}

export function LeagueChips({ leagues }: { leagues: LeagueId[] }) {
  return <>{leagues.map(l => <Chip key={l}>{LEAGUE_NAME[l]}</Chip>)}</>;
}

/** Segmented choice. `scroll` keeps it on one line that swipes sideways on a phone (for long option lists such as the Manage areas). */
export function Seg<T extends string>({ label, value, options, onChange, scroll = false }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; scroll?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scroll || !ref.current) return;
    const on = ref.current.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (on) ref.current.scrollTo({ left: on.offsetLeft - 8 });
  }, [scroll, value]);
  return (
    <div ref={ref} className={scroll ? 'seg scroll' : 'seg'} role="group" aria-label={label}>
      {options.map(([k, text]) => (
        <button key={k} type="button" aria-pressed={k === value} onClick={() => onChange(k)}>{text}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([k, text]) => (
        <button key={k} type="button" role="tab" aria-selected={k === value} onClick={() => onChange(k)}>{text}</button>
      ))}
    </div>
  );
}

export function Pips({ up, total = 5 }: { up: number; total?: number }) {
  return (
    <div className="pips" role="img" aria-label={`${up} of ${total} standing`}>
      {Array.from({ length: total }, (_, i) => <i key={i} className={`pip ${i < up ? '' : 'down'}`} />)}
    </div>
  );
}

export function PageHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h1 style={{ fontSize: 'clamp(46px,7vw,88px)', marginTop: 10 }}>{title}</h1>
      {lede && <p style={{ color: 'var(--muted)', marginTop: 12, fontSize: 17, maxWidth: '62ch' }}>{lede}</p>}
    </div>
  );
}

export function SectionHead({ title, to, more }: { title: string; to?: ReactNode; more?: string }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {to && more ? <span className="more">{to}</span> : null}
    </div>
  );
}

export const tierMultiplierLabel = (t: TierName) => t;

/** Marks fictional/test records wherever they are shown. Pass the record's id or slug; renders nothing for real records. */
export function TestBadge({ synthetic }: { synthetic: boolean }) {
  if (!synthetic) return null;
  return <span className="chip brass" title="Fictional test data. Not an official record; excluded from rankings and statistics." style={{ marginLeft: 8, verticalAlign: 'middle' }}>Test data</span>;
}
