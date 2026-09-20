import { Link } from 'react-router-dom';
import { demoFighters, demoTeams, liveMatches, upcomingMatches } from '../data/showcase';
import { Avatar, Panel, Pill } from '../components/ShowcaseUI';

export function ShowcasePublicPage(){
  const bob=demoFighters[0];
  const alex=demoFighters.find(f=>f.id==='alex')!;
  return <div className="show-public">
    <section className="show-public-hero">
      <div className="show-public-nav"><div className="show-brand"><span className="show-brand-mark">B</span><span><b>BuhurtOS</b><small>HACSA Fall Open</small></span></div><div><button>Schedule</button><button>Brackets</button><button>Standings</button><button>What is Buhurt?</button><Link className="show-public-staff-link" to="/home">Staff preview</Link></div></div>
      <div className="show-public-live-label"><span className="show-live-dot"></span> LIVE FROM SPRINGBROOK</div>
      <h1>HACSA Fall Open</h1><p>Follow every field, fighter, bracket and result live.</p>
      <div className="show-public-actions"><button className="show-btn light">▶ Watch livestream</button><button className="show-btn glass">View full schedule</button></div>
    </section>
    <section className="show-public-live-grid">
      <article className="show-public-main-score">
        <div className="show-public-score-head"><div><Pill tone="red">● LIVE</Pill><span>Field 1</span></div><span>5v5 • Pool A • Round 2</span></div>
        <div className="show-public-teams"><div><span className="show-team-logo-public purple">RR</span><b>Red Deer Reavers</b><strong>1</strong></div><i>VS</i><div><span className="show-team-logo-public blue">NV</span><b>Northern Vanguard</b><strong>0</strong></div></div>
        <div className="show-public-clock"><span>Round 2</span><strong>00:42</strong></div>
        <div className="show-explain-card"><span>?</span><div><b>How does 5v5 work?</b><p>A fighter is considered down when they have three points of contact with the ground. The team with fighters still standing wins the round. First team to win the required rounds wins the match.</p></div><button>Full rules</button></div>
      </article>
      <aside className="show-public-next"><span className="eyebrow">UP NEXT</span>{upcomingMatches.slice(0,3).map((m,i)=><article key={i}><time>{m.time}</time><div><b>{m.left}</b><span>vs</span><b>{m.right}</b><small>{m.field} • {m.division}</small></div></article>)}</aside>
    </section>
    <section className="show-public-section"><div className="show-public-section-head"><div><span className="eyebrow">LIVE ACROSS THE VENUE</span><h2>Three fields. One live view.</h2></div><button>View all fights →</button></div><div className="show-public-field-grid">{liveMatches.map(m=><article key={m.id}><div><span className="show-live-dot"></span><b>{m.field}</b><Pill tone="red">{m.clock}</Pill></div><small>{m.division} • {m.round}</small><section><strong>{m.left}</strong><span>{m.leftScore} : {m.rightScore}</span><strong>{m.right}</strong></section></article>)}</div></section>
    <section className="show-public-section"><div className="show-public-section-head"><div><span className="eyebrow">FEATURED FIGHT</span><h2>Meet the fighters</h2></div><button>Fighter directory →</button></div><div className="show-versus-feature"><Link to={'/fighters/'+bob.id}><Avatar initials="BM" tone="ember" size="xl"/><small>RED DEER REAVERS</small><h3>{bob.fighterName}</h3><div><strong>{bob.record.wins}–{bob.record.losses}–{bob.record.draws}</strong><span>Career</span></div><Pill tone="amber">HACSA #3</Pill></Link><span className="show-vs-mark">VS</span><Link to={'/fighters/'+alex.id}><Avatar initials="AM" tone="blue" size="xl"/><small>NORTHERN VANGUARD</small><h3>{alex.fighterName}</h3><div><strong>{alex.record.wins}–{alex.record.losses}–{alex.record.draws}</strong><span>Career</span></div><Pill tone="blue">HACSA #6</Pill></Link></div></section>
    <section className="show-public-section"><div className="show-public-section-head"><div><span className="eyebrow">5V5 CHAMPIONSHIP</span><h2>Bracket</h2></div><button>Full bracket →</button></div><div className="show-bracket-preview public"><div className="round"><h4>Quarterfinals</h4><span className="done">Reavers 2–0 Badlands</span><span className="done">Vanguard 2–1 Iron Wolves</span><span>North Guard vs Wild Rose</span><span>Steel Legion vs Foothills</span></div><div className="connector">›</div><div className="round"><h4>Semifinals</h4><span>Red Deer Reavers vs Northern Vanguard</span><span>Winner QF3 vs Winner QF4</span></div><div className="connector">›</div><div className="round final"><h4>Final</h4><span>Winner SF1 vs Winner SF2</span></div></div></section>
    <section className="show-public-section two"><Panel title="What is Buhurt?" subtitle="Armored full-contact medieval combat"><p className="show-long-copy">Buhurt is a modern combat sport fought in historically inspired armor. Different divisions use different weapons and scoring systems, from point-based one-on-one duels to team melees where the last fighters standing win.</p><button className="show-btn primary">Learn the sport</button></Panel><Panel title="Teams competing today"><div className="show-public-team-list">{demoTeams.map(t=><Link to={'/teams/'+t.id} key={t.id}><span style={{borderColor:t.color}}>{t.logoText}</span><div><b>{t.name}</b><small>{t.region}</small></div><i>›</i></Link>)}</div></Panel></section>
    <footer className="show-public-footer"><div className="show-brand"><span className="show-brand-mark">B</span><span><b>BuhurtOS</b><small>Powered by live tournament data</small></span></div><p>Prototype spectator experience • Demo information</p></footer>
  </div>;
}
