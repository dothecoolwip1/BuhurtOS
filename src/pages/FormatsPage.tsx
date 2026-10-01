import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LeagueIcon } from '../components/LeagueIcon';
import { ZoneFigure } from '../components/ZoneFigure';
import { Chip, Seg, Tabs } from '../components/ui';
import { LEAGUES } from '../content/leagues';
import { TIERS } from '../content/tiers';
import type { LeagueId } from '../data/types';
import { leaguePoints, structureAdvice, zoneValues, type DuelCategory, type Grip, type MultiplierSource, type Placement, type TierName } from '../lib/tournament';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Tab = 'styles' | 'tournaments';
const TABS: readonly (readonly [Tab, string])[] = [['styles', 'Fighting styles'], ['tournaments', 'Tournaments and points']];
const DUEL_CATS: readonly (readonly [DuelCategory, string])[] = [['swordShield', 'Sword & Shield'], ['buckler', 'Sword & Buckler'], ['longsword', 'Longsword'], ['polearm', 'Polearm']];

/* ---------------- group fight ---------------- */
function BuhurtDetail() {
  return (
    <>
      <div className="two">
        <div className="panel info"><h3>A fighter is grounded when…</h3><ul className="bul no"><li>Torso, hip, arm, hand, knee or shield touches the ground. Only the two feet may.</li><li>They lean on a grounded fighter with downward pressure.</li><li>An armour element fails and cannot protect any more.</li><li>They attack, push or grapple without a weapon in hand.</li><li>They yield by kneeling.</li></ul></div>
        <div className="panel info"><h3>…but not when</h3><ul className="bul ok"><li>They touch down with the shield edge, an open hand or a fist during or just after a successful takedown.</li><li>They touch the opponent they are falling with, except with torso, hips or buttocks.</li><li>Remaining armour covers the failed piece.</li><li>Any part of a weapon touches the ground.</li></ul></div>
      </div>
      <div className="panel info" style={{ marginTop: 16 }}><h3>List sizes by format</h3>
        <div className="tbl"><table><thead><tr><th>Format</th><th className="num">Length</th><th className="num">Width</th><th>Registered by a team</th></tr></thead><tbody>
          <tr><td><b>3v3</b></td><td className="num">7 to 20 m</td><td className="num">5 to 15 m</td><td>Men 3 to 5 · Women 3 to 5</td></tr>
          <tr><td><b>5v5</b></td><td className="num">9 to 20 m</td><td className="num">7 to 15 m</td><td>Men 5 to 8 · Women 3 to 8</td></tr>
          <tr><td><b>12v12</b></td><td className="num">15 to 20 m</td><td className="num">7 to 15 m</td><td>12 to 20 licensed competitors</td></tr>
          <tr><td><b>30v30</b></td><td className="num">25 to 30 m</td><td className="num">12.5 to 20 m</td><td>Not stated in the files provided</td></tr></tbody></table></div></div>
      <div className="facts-grid" style={{ marginTop: 16 }}>
        <div className="fact"><small>Weight classes</small><b>None</b><span>No weight categories in group fights.</span></div>
        <div className="fact"><small>Rail and safety zone</small><b>0.9 to 1.3 m</b><span>Rail height, with a fenced 2 m safety zone around the list.</span></div>
        <div className="fact"><small>Team size</small><b>5 to 20</b><span>Men. Women's teams may have 3 to 20. A fighter can be on only one team's roster.</span></div>
        <div className="fact"><small>Officials</small><b>Knight + line</b><span>Knight Marshal, field marshals, line marshals, secretary and an Authenticity Committee rep.</span></div>
      </div>
      <div className="panel info" style={{ marginTop: 16 }}><h3>Stopped immediately</h3><ul className="bul no"><li>Thrusts, or threatening one.</li><li>Strikes to the neck, base of the skull, back of the knee, groin, feet and ankles.</li><li>Striking a grounded fighter, joint locks, suplex-style throws and spikes on the head or neck.</li><li>An inactive clinch lasting 10 seconds or more.</li></ul></div>
      <p className="src" style={{ marginTop: 12 }}>Sources: Buhurt Rules V.26.4.1 §1, §4, §6; Buhurt Regulations V.26.4 §1 to §3; League Structure V2026.1 §3.1. The round and match structure (Regulations §4) was not readable in the files provided, so it is not shown.</p>
    </>
  );
}

/* ---------------- duels ---------------- */
const DUEL_FACTS: Record<DuelCategory, { title: string; rounds: string[]; techniques: string[]; tech: string }> = {
  swordShield: { title: 'Sword & Shield', rounds: ['2 main rounds of 1 minute; the match goes to a lead of 2 or more points over the total.', 'Under a 2-point lead: extra 30-second rounds until it is reached.', '30-second break between rounds.'], techniques: ['Shield pushes, hooks and covers are allowed.', 'Strikes with the edge of the shield are not.'], tech: '10–0 per round' },
  buckler: { title: 'Sword & Buckler', rounds: ['A round goes to the first to 5 points, or the higher score at 1 minute. Maximum 5 per round.', 'The first to win 2 rounds wins the match.', 'No break between rounds.'], techniques: ['Strikes with the flat of the buckler are allowed.', 'Strikes with the edge of the buckler are not.'], tech: '5–0 × 2' },
  longsword: { title: 'Longsword', rounds: ['2 main rounds of 1 minute; the match goes to a lead of 2 or more points over the total.', 'Under a 2-point lead: extra 30-second rounds until it is reached.', '30-second break between rounds.'], techniques: ['Pushing with the blade or arms is allowed.', 'Pommel and cross-guard strikes are not.'], tech: '10–0 per round' },
  polearm: { title: 'Polearm', rounds: ['2 main rounds of 1 minute; the match goes to a lead of 2 or more points over the total.', 'Under a 2-point lead: extra 30-second rounds until it is reached.', 'Both hands must hold the grip for a strike to count; haft strikes score nothing.'], techniques: ['A free-hand strike is allowed if the other hand holds the weapon.', 'Hands, elbows and legs are otherwise prohibited.'], tech: '10–0 per round' }
};

function DuelsDetail({ cat, grip, onCat, onGrip }: { cat: DuelCategory; grip: Grip; onCat: (c: DuelCategory) => void; onGrip: (g: Grip) => void }) {
  const v = zoneValues(cat, grip);
  const F = DUEL_FACTS[cat];
  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Seg label="Duel category" value={cat} options={DUEL_CATS} onChange={onCat} />
        {cat === 'longsword' && <Seg label="Grip" value={grip} options={[['two', 'Two hands on grip'], ['one', 'One hand']] as const} onChange={onGrip} />}
      </div>
      <div className="panel fig-wrap" style={{ marginTop: 14 }}>
        <div><ZoneFigure v={v} /></div>
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 style={{ fontSize: 32 }}>{F.title}: points per clean strike</h3>
          <div className="legend"><span><i style={{ background: 'var(--steel)' }} />2 points</span><span><i style={{ background: 'var(--steel-soft)', boxShadow: 'inset 0 0 0 1px var(--steel)' }} />1 point</span><span><i style={{ background: 'var(--ground)', boxShadow: 'inset 0 0 0 1px var(--faint)' }} />0 points</span><span><i style={{ boxShadow: 'inset 0 0 0 1.5px var(--live)' }} />Illegal: neck, base of skull, back of knee, groin, feet</span></div>
          <p style={{ color: 'var(--muted)', fontSize: 15 }}>A strike counts when it is clear and deliberate and the opponent did not counter it. Only the blade scores in these categories, and thrusting is prohibited.</p>
        </div>
      </div>
      <div className="two" style={{ marginTop: 16 }}>
        <div className="panel info"><h3>How a match is won</h3><ul className="bul">{F.rounds.map(x => <li key={x}>{x}</li>)}</ul></div>
        <div className="panel info"><h3>Techniques</h3><ul className="bul">{F.techniques.map(x => <li key={x}>{x}</li>)}<li>Grappling, throws, head, foot and knee strikes are prohibited in duels.</li></ul></div>
      </div>
      <div className="facts-grid" style={{ marginTop: 16 }}>
        <div className="fact"><small>List</small><b>5 to 10 m</b><span>Rail 0.9 to 1.3 m, with a fenced 2 m safety zone.</span></div>
        <div className="fact"><small>Weight classes</small><b>None</b><span>Duels are open weight.</span></div>
        <div className="fact"><small>Officials</small><b>1 + 4</b><span>Knight Marshal plus four line marshals, timekeeper, AC rep and video supervisor.</span></div>
        <div className="fact"><small>Technical win</small><b>{F.tech}</b><span>Withdrawal, no-show, injury from an illegal strike, or 2 yellow / 1 red card.</span></div>
      </div>
      <p className="src" style={{ marginTop: 12 }}>Source: Duels rules V.26.4 §1 to §4. The duel regulations also name a Triathlon category; no rules for it were in the files provided.</p>
    </>
  );
}

/* ---------------- profight ---------------- */
const BANDS: [string, string, string, number][] = [
  ['10–10', 'Even', 'Strike gap of 5 or less and no other criteria decide it', 4],
  ['10–9', 'Slight', 'Out-struck by 6 to 10 strike points (or won on other criteria)', 35],
  ['10–8', 'Moderate', 'Out-struck by 11 to 15', 65],
  ['10–7', 'Dominant', 'Out-struck by 16 or more. KO and TKO also score this', 100]
];
function OutranceDetail() {
  const men: [string, string][] = [['Lightweight', 'to 75 kg'], ['Middleweight', '75 to 85 kg'], ['Light heavyweight', '85 to 95 kg'], ['Heavyweight', '95 to 105 kg'], ['Super heavyweight', '105 to 115 kg'], ['Ultra heavyweight', 'over 115 kg']];
  const women: [string, string][] = [['Featherweight', 'to 60 kg'], ['Lightweight', '60 to 70 kg'], ['Middleweight', '70 to 80 kg'], ['Light heavyweight', '80 to 90 kg'], ['Heavyweight', 'over 90 kg']];
  const list = (rows: [string, string][]) => <dl className="dl">{rows.map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>;
  return (
    <>
      <div className="two"><div className="panel info"><h3>Men's weight classes</h3>{list(men)}</div><div className="panel info"><h3>Women's weight classes</h3>{list(women)}</div></div>
      <div className="panel info" style={{ marginTop: 16 }}><h3>Round time by division</h3>
        <div className="tbl"><table><thead><tr><th /><th>Matched fight</th><th>Tournament fight</th></tr></thead><tbody>
          <tr><td><b>Division 1</b><div className="src">over 2 years competing, or international experience</div></td><td>3 rounds of 2:00, 1:00 breaks</td><td>2 rounds of 2:00, 45 s break</td></tr>
          <tr><td><b>Division 2</b><div className="src">under 2 years, little international experience</div></td><td>3 rounds of 1:30, 1:00 breaks</td><td>2 rounds of 1:30, 45 s break</td></tr></tbody></table></div>
        <p className="src">A level tournament fight gets a third round. Division 2 fighters may choose to fight in Division 1.</p></div>
      <div className="panel info" style={{ marginTop: 16 }}><h3>How each round is scored (10-point must)</h3>
        <div className="scoreband">{BANDS.map(([s, l, t, w]) => (<div key={s}><div className="sband"><b className="mono">{s}</b><div className="bar"><i style={{ width: `${w}%` }} /></div><span>{l}</span></div><p className="src" style={{ margin: '4px 0 4px 108px' }}>{t}</p></div>))}</div>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>Each strike point is one clean legal blow with a weapon, leg, arm or shield. Yellow cards, armour failures and weapon losses each cost one point. Line marshals score alone, and the secretary averages them.</p></div>
      <div className="two" style={{ marginTop: 16 }}>
        <div className="panel info"><h3>What judges weigh, in order</h3><ul className="bul"><li>Effective striking</li><li>Effective grappling: takedowns, reversals, clinch control</li><li>Effective list control</li><li>Effective aggression</li><li>Effective defence</li></ul></div>
        <div className="panel info"><h3>How a fight can end</h3><ul className="bul"><li>Unanimous, majority or split decision</li><li>Unanimous, majority or split draw</li><li>Technical knockout (TKO), including corner stoppage</li><li>Knockout (KO)</li></ul></div>
      </div>
      <p className="src" style={{ marginTop: 12 }}>Source: Outrance Rules and Regulations V.26.4 §1, §4, §13, §15, §17. Profight rankings track win/loss record within a weight class; a fighter inactive for 1 year becomes retired.</p>
    </>
  );
}

/* ---------------- tournaments ---------------- */
function Advisor() {
  const [n, setN] = useState(10);
  const a = structureAdvice(n);
  const band = { 'under-4': 'Under 4', '4-6': '4–6', '6-12': '6–12', '12-16': '12–16', '16-20': '16–20', '20+': '20+' }[a.band];
  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div><h2 style={{ fontSize: 40 }}>Which structure for how many entrants?</h2><p style={{ color: 'var(--muted)', marginTop: 8 }}>Drag to set the number of teams or duellists. The options follow the Tournament Structure document.</p></div>
      <div className="panel info"><label className="field-in" htmlFor="nEnt"><span>Entrants (teams or duellists)</span></label>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}><input className="range" id="nEnt" type="range" min={3} max={24} value={n} onChange={e => setN(+e.target.value)} aria-label="Number of entrants" /><span className="nbig mono" style={{ minWidth: '2ch', textAlign: 'right' }}>{n}</span></div></div>
      <div style={{ display: 'grid', gap: 14 }}>
        <div><Chip tone="steel">{band} entrants</Chip></div>
        {a.note && <div className="panel opt"><p style={{ color: 'var(--muted)' }}>{a.note}</p></div>}
        {a.options.map(o => (
          <div className="panel opt" key={o.title}><h3>{o.title}</h3><p style={{ color: 'var(--muted)', fontSize: 15, maxWidth: '70ch' }}>{o.detail}</p>
            <div className="flow">
              {o.pools.map((z, i) => <div className="pool" key={i}><small>{o.pools.length > 1 ? `Pool ${String.fromCharCode(65 + i)}` : 'One group'}</small><b>{z}</b></div>)}
              <div className="arrow">{o.advancing ? 'top 2 from each pool →' : 'all play all →'}</div>
              <div className="stage"><b>{o.advancing ? `${o.advancing} advance` : 'Ranked by wins'}</b><small>{o.after}</small></div>
            </div>
          </div>
        ))}
        <p className="src">Source: Tournament Structure and Formats §1.2 to §1.7. Registration closes at least 15 days before an event.</p>
      </div>
    </section>
  );
}

function Calculator() {
  const [tier, setTier] = useState<TierName>('Classic');
  const [source, setSource] = useState<MultiplierSource>('tournamentStructure');
  const [pool, setPool] = useState(3);
  const [elim, setElim] = useState(2);
  const [place, setPlace] = useState<Placement>('second');
  const r = leaguePoints({ poolWins: pool, eliminationWins: elim, placement: place, tier, source });
  const num = (v: string) => Math.max(0, Number.parseInt(v, 10) || 0);
  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div><h2 style={{ fontSize: 40 }}>League points calculator</h2><p style={{ color: 'var(--muted)', marginTop: 8 }}>1 point per pool or round-robin win, 2 per elimination win, plus 2, 4 or 6 for 3rd, 2nd or 1st. Then the tier multiplier.</p></div>
      <div className="calc">
        <div className="panel info">
          <label className="field-in"><span>Tier</span><select value={tier} onChange={e => setTier(e.target.value as TierName)}>{TIERS.map(t => <option key={t.name}>{t.name}</option>)}</select></label>
          <label className="field-in"><span>Multiplier source</span><select value={source} onChange={e => setSource(e.target.value as MultiplierSource)}><option value="tournamentStructure">Tournament Structure §4.2 (×1.25 Regional, ×1.5 Conference)</option><option value="leagueStructure">League Structure §2.3 (150% Regional, 200% Conference)</option></select></label>
          <label className="field-in"><span>Pool or round-robin wins</span><input type="number" min={0} max={12} value={pool} onChange={e => setPool(num(e.target.value))} /></label>
          <label className="field-in"><span>Elimination wins</span><input type="number" min={0} max={6} value={elim} onChange={e => setElim(num(e.target.value))} /></label>
          <label className="field-in"><span>Placement</span><select value={place} onChange={e => setPlace(e.target.value as Placement)}><option value="none">Did not place</option><option value="third">3rd place (+2)</option><option value="second">2nd place (+4)</option><option value="first">1st place (+6)</option></select></label>
        </div>
        <div className="result"><p className="eyebrow">League points</p><div className="nbig mono">{r.total}</div>
          <p style={{ fontSize: 14, opacity: 0.8 }}>({pool} pool + {elim}×2 elimination + {r.base - pool - 2 * elim} placement) = {r.base}, × {r.multiplier}</p>
          {r.multiplier === 0 && <p style={{ fontSize: 13, opacity: 0.8 }}>Exhibition events award no points.</p>}</div>
      </div>
    </section>
  );
}

const TIEBREAKS: [string, string][] = [['Head-to-head', 'Only when two are tied: the winner of their match ranks higher.'], ['Round or hit ratio', 'Group fights and buckler: round wins minus losses. Other duels: hits earned against hits received.'], ['Active against downed', 'Difference between fighters still standing and fighters grounded at the end of each round.'], ['Fewest penalties', 'The team or duellist with the fewest penalties ranks higher.']];
const CARDS: [string, string, string][] = [['v', 'Verbal warning', 'Minor violation. Three verbal warnings in a profight become a yellow card.'], ['y', 'Yellow card', 'Systematic violations or a serious one. Costs a point in a profight. Affects only the tournament it happens in.'], ['r', 'Red card', 'Disqualification. A second yellow becomes a red. In duels, opponents then get technical wins.'], ['g', 'Green card', 'Breach of authenticity rules. Follows the competitor from tournament to tournament.']];

function Tournaments() {
  return (
    <div style={{ display: 'grid', gap: 36 }}>
      <section style={{ display: 'grid', gap: 16 }}>
        <div><h2 style={{ fontSize: 40 }}>Five tournament tiers</h2><p style={{ color: 'var(--muted)', marginTop: 8, maxWidth: '64ch' }}>A tier decides how many points an event awards, how far ahead it must be submitted, and what marshals, entrants and streaming it needs. One event can run several tiers at once.</p></div>
        <div className="tiers">{TIERS.map(t => (
          <div className="panel tier" key={t.name}><div><h3>{t.name}</h3></div><div className="pct">{t.pointsGiven}</div><p className="src">{t.note}</p>
            <dl><div><dt>Submit to BI</dt><dd>{t.submitDays === 'No submission needed' ? t.submitDays : `${t.submitDays} ahead`}</dd></div><div><dt>Marshals</dt><dd>{t.marshals}</dd></div><div><dt>Group fight entrants</dt><dd>{t.groupEntrants}</dd></div><div><dt>Duel entrants</dt><dd>{t.duelEntrants}</dd></div><div><dt>Video</dt><dd>{t.video}</dd></div></dl></div>
        ))}</div>
        <div className="conflict"><span className="chip brass">Sources disagree</span><p><b>Two multipliers are in the documents.</b> League Structure §2.3 gives Regional 150% and Conference 200% of points. Its §3.3.2 and the Tournament Structure document give ×1.25 and ×1.5. Both are shown in the calculator below until the owner decides which BuhurtOS follows.</p></div>
      </section>
      <Advisor />
      <Calculator />
      <section style={{ display: 'grid', gap: 16 }}><div><h2 style={{ fontSize: 40 }}>Breaking a tie</h2><p style={{ color: 'var(--muted)', marginTop: 8 }}>In order, until the tie is resolved.</p></div>
        <div className="steps">{TIEBREAKS.map(([a, b]) => <div className="panel step" key={a}><div><b>{a}</b><p>{b}</p></div></div>)}</div></section>
      <section style={{ display: 'grid', gap: 16 }}><div><h2 style={{ fontSize: 40 }}>Cards and penalties</h2></div>
        <div className="cards3">{CARDS.map(([c, a, b]) => <div className="panel cardtile" key={a}><span className={`cc ${c}`} /><div><b>{a}</b><p>{b}</p></div></div>)}</div></section>
      <section style={{ display: 'grid', gap: 16 }}><div><h2 style={{ fontSize: 40 }}>The season</h2></div>
        <div className="facts-grid">
          <div className="fact"><small>Season</small><b>Jan 15 – Dec 1</b><span>Licences can be renewed from Nov 1.</span></div>
          <div className="fact"><small>Transfer window</small><b>Dec 1 – Jan 14</b><span>Teams get 6 transfer tokens per season.</span></div>
          <div className="fact"><small>Season score</small><b>Top 3 events</b><span>Average of the best three tournaments. Counts as 0 until three are done.</span></div>
          <div className="fact"><small>Dropping out</small><b>−5 points</b><span>For leaving a tournament within 72 hours of its start.</span></div>
          <div className="fact"><small>Conferences</small><b>4</b><span>North America, South America, APAC, Europe. Each country is a region.</span></div>
          <div className="fact"><small>Divisions</small><b>1 and 2</b><span>Set by National Organisations for 2026, confirmed by the BI Committee.</span></div>
        </div>
        <p className="src">Sources: League Structure V2026.1; Tournament Structure and Formats (Jan 2026); Marshal accreditation levels: Trainee (4), Regional (3), Conference (2), International (1).</p></section>
    </div>
  );
}

export function FormatsPage() {
  useDocumentTitle('Formats');
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'tournaments' ? 'tournaments' : 'styles';
  const lg: LeagueId = (['buhurt', 'duels', 'outrance'] as const).find(x => x === params.get('lg')) ?? 'buhurt';
  const cat: DuelCategory = DUEL_CATS.find(([k]) => k === params.get('cat'))?.[0] ?? 'swordShield';
  const grip: Grip = params.get('grip') === 'one' ? 'one' : 'two';
  const update = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) { if (v === null) p.delete(k); else p.set(k, v); }
    setParams(p, { replace: true });
  };
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 26 }}>
      <div><p className="eyebrow">How the sport works</p><h1 style={{ fontSize: 'clamp(46px,7vw,92px)', marginTop: 10 }}>Formats</h1>
        <p style={{ color: 'var(--muted)', marginTop: 12, fontSize: 17, maxWidth: '62ch' }}>Three leagues, each with its own rules and scoring, and a shared tournament and points system on top.</p></div>
      <Tabs value={tab} options={TABS} onChange={t => update({ tab: t === 'styles' ? null : t })} />
      <div style={{ display: 'grid', gap: 22 }}>
        {tab === 'styles' ? (
          <>
            <div className="lg-cards">{LEAGUES.map(l => (
              <button key={l.id} type="button" className="lgcard" aria-pressed={l.id === lg} onClick={() => update({ lg: l.id })}>
                <span className="ic"><LeagueIcon id={l.id} /></span>
                <div><p className="eyebrow">{l.tag}</p><h3 style={{ marginTop: 6 }}>{l.name}</h3></div>
                <p>{l.summary}</p><div className="cats">{l.categories.map(c => <Chip key={c}>{c}</Chip>)}</div>
              </button>
            ))}</div>
            <div className="fade-in" key={lg}>
              {lg === 'buhurt' && <BuhurtDetail />}
              {lg === 'duels' && <DuelsDetail cat={cat} grip={grip} onCat={c => update({ cat: c })} onGrip={g => update({ grip: g })} />}
              {lg === 'outrance' && <OutranceDetail />}
            </div>
          </>
        ) : <Tournaments />}
      </div>
    </section>
  );
}
