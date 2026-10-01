import type { ZoneValues } from '../lib/tournament';

const cls = (n: number) => `z${n}`;
const Label = ({ x, y, n }: { x: number; y: number; n: number }) => (
  <text className={n === 2 ? 'zt' : 'zt1'} x={x} y={y} textAnchor="middle" style={n === 0 ? { fill: 'var(--faint)' } : undefined}>{n}</text>
);

/** Front-view body figure, shaded by points per clean strike. Dashed red outlines are illegal zones. */
export function ZoneFigure({ v }: { v: ZoneValues }) {
  return (
    <svg className="zfig" viewBox="0 0 160 300" role="img" aria-label={`Scoring zones: head ${v.head}, torso ${v.torso}, arms ${v.arms}, hands ${v.hands}, legs ${v.legs}`}>
      <circle className={cls(v.head)} cx="80" cy="30" r="21" strokeWidth="2" /><Label x={80} y={35} n={v.head} />
      <rect className={cls(v.torso)} x="52" y="58" width="56" height="88" rx="12" strokeWidth="2" /><Label x={80} y={108} n={v.torso} />
      <rect className={cls(v.arms)} x="26" y="62" width="22" height="108" rx="11" strokeWidth="2" /><rect className={cls(v.arms)} x="112" y="62" width="22" height="108" rx="11" strokeWidth="2" />
      <Label x={37} y={120} n={v.arms} /><Label x={123} y={120} n={v.arms} />
      <circle className={cls(v.hands)} cx="37" cy="190" r="12" strokeWidth="2" /><circle className={cls(v.hands)} cx="123" cy="190" r="12" strokeWidth="2" />
      <Label x={37} y={195} n={v.hands} /><Label x={123} y={195} n={v.hands} />
      <rect className={cls(v.legs)} x="54" y="152" width="24" height="112" rx="11" strokeWidth="2" /><rect className={cls(v.legs)} x="82" y="152" width="24" height="112" rx="11" strokeWidth="2" />
      <Label x={66} y={212} n={v.legs} /><Label x={94} y={212} n={v.legs} />
      <rect className="zx" x="52" y="268" width="28" height="22" rx="6" strokeWidth="1.6" /><rect className="zx" x="80" y="268" width="28" height="22" rx="6" strokeWidth="1.6" />
      <rect className="zx" x="70" y="46" width="20" height="10" rx="4" strokeWidth="1.6" />
    </svg>
  );
}
