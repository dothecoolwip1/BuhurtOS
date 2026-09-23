import { Link } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeToggle';

const audiences = [
  {
    icon: '⌘',
    title: 'Organizations',
    text: 'Run seasons, sanctioned events, teams, rulesets, rankings, registrations, discipline and official records from one system.'
  },
  {
    icon: '♜',
    title: 'Teams & Captains',
    text: 'Manage rosters, invite fighters, build event lineups, track readiness and keep team history without owning a fighter’s personal profile.'
  },
  {
    icon: '♟',
    title: 'Fighters',
    text: 'One permanent profile for your career: team history, results, records, rankings, podiums, photos, achievements and upcoming fights.'
  },
  {
    icon: '◎',
    title: 'Spectators',
    text: 'Understand what is happening live: who is fighting, how the rules work, what comes next, brackets, standings and fighter profiles.'
  }
];

const problems = [
  ['Tournament data gets scattered', 'Registration, fight cards, brackets, scores, waivers, rankings and results often live in different places. BuhurtOS is designed to connect them.'],
  ['Fighter history disappears', 'A result should not vanish after an event or reset when someone changes teams. BuhurtOS treats a fighter as one permanent sporting identity.'],
  ['Spectators are left guessing', 'Buhurt can be hard to follow if you do not already know the sport. BuhurtOS gives the audience a simple live view and explains what they are watching.'],
  ['Event day is chaotic', 'Marshals need fast, glove-friendly controls, live field queues, check-in status and offline resilience instead of spreadsheets and message chains.'],
  ['Organizations repeat the same work', 'A finalized match should update the bracket, standings, fighter record, team record and public view automatically instead of being entered over and over.'],
  ['Rules change over time', 'Versioned rulesets preserve which rules were used at each event, even when BI, HACSA or another organization changes them later.']
];

const capabilities = [
  'Federations, organizations, teams and fighters',
  'Season and event management',
  'Public registration, waivers and check-in',
  'Armor, medical and weigh-in clearance',
  'Pools, brackets and fight cards',
  'Live scoring and multi-field operations',
  'Rankings, records and historical results',
  'Team captain and fighter self-service',
  'Discipline, cards and suspensions',
  'Public live event and spectator pages',
  'Versioned rulesets and local amendments',
  'Offline-first tournament-day workflows',
  'Livestream and broadcast-ready views',
  'CSV, printable and future official reports',
  'Permanent fighter and team history'
];

export function MarketingHome(){
  return <div className="marketing">
    <header className="marketing-nav">
      <Link to="/" className="show-brand">
        <span className="show-brand-mark">B</span>
        <span><b>BuhurtOS</b><small>The operating system for Buhurt</small></span>
      </Link>
      <nav>
        <a href="#why">Why</a>
        <a href="#how">How it works</a>
        <a href="#features">Features</a>
        <a href="#cost">Cost</a>
      </nav>
      <div className="marketing-nav-actions"><ThemeToggle/>
        <Link className="show-btn secondary" to="/public">Spectator demo</Link>
        <Link className="show-btn primary" to="/home">Explore prototype</Link>
      </div>
    </header>

    <main>
      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <span className="marketing-kicker"><i></i> Built for the sport, not adapted from another one</span>
          <h1>Everything Buhurt.<br/><em>One system.</em></h1>
          <p>BuhurtOS is being built as a complete tournament and competition platform for governing organizations, event organizers, teams, fighters, marshals and spectators.</p>
          <div className="marketing-hero-actions">
            <Link className="show-btn primary large" to="/home">Explore the working prototype →</Link>
            <Link className="show-btn secondary large" to="/public">See the spectator experience</Link>
          </div>
          <div className="marketing-proof">
            <span><b>BI</b><small>Federation</small></span>
            <i>›</i>
            <span><b>HACSA</b><small>Organization</small></span>
            <i>›</i>
            <span><b>Reavers</b><small>Team</small></span>
            <i>›</i>
            <span><b>Bob</b><small>Fighter</small></span>
          </div>
        </div>
        <div className="marketing-hero-ui">
          <div className="marketing-window">
            <div className="marketing-window-top"><span></span><span></span><span></span><b>HACSA Fall Open</b><small>LIVE</small></div>
            <div className="marketing-window-body">
              <div className="marketing-demo-head"><div><small>FIELD 1 • 5V5</small><b>Live now</b></div><strong>00:42</strong></div>
              <div className="marketing-demo-score">
                <div><span className="marketing-team-mark purple">RR</span><b>Red Deer<br/>Reavers</b><strong>1</strong></div>
                <i>VS</i>
                <div><strong>0</strong><b>Northern<br/>Vanguard</b><span className="marketing-team-mark blue">NV</span></div>
              </div>
              <div className="marketing-demo-next"><span>UP NEXT</span><b>Iron Wolves vs Badlands Forge</b><small>Field 1 • approx. 2:35 PM</small></div>
              <div className="marketing-demo-explain"><span>?</span><div><b>New to Buhurt?</b><small>Tap any division to see how it works and what decides the winner.</small></div></div>
            </div>
          </div>
          <div className="marketing-float-card one"><span>✓</span><div><b>One result entered</b><small>Bracket + rankings + fighter record updated</small></div></div>
          <div className="marketing-float-card two"><span>↻</span><div><b>Offline-ready</b><small>Built for real tournament conditions</small></div></div>
        </div>
      </section>

      <section className="marketing-strip">
        <p>Designed around the real Buhurt ecosystem</p>
        <div><span>Buhurt International</span><i>•</i><span>HACSA</span><i>•</i><span>Teams</span><i>•</i><span>Fighters</span><i>•</i><span>Marshals</span><i>•</i><span>Spectators</span></div>
      </section>

      <section className="marketing-section" id="why">
        <div className="marketing-section-head">
          <span className="eyebrow">WHY BUHURTOS</span>
          <h2>Buhurt already has enough moving parts.</h2>
          <p>The software should remove work, not create more of it.</p>
        </div>
        <div className="marketing-problem-grid">
          {problems.map(([title,text],i)=><article key={title}><span>{String(i+1).padStart(2,'0')}</span><h3>{title}</h3><p>{text}</p></article>)}
        </div>
      </section>

      <section className="marketing-dark-section" id="how">
        <div className="marketing-section-head centered">
          <span className="eyebrow">ONE SHARED SYSTEM</span>
          <h2>Different people. Different views.<br/>The same tournament underneath.</h2>
          <p>Everyone sees what they need without maintaining separate copies of the same information.</p>
        </div>
        <div className="marketing-audience-grid">
          {audiences.map(a=><article key={a.title}><span>{a.icon}</span><h3>{a.title}</h3><p>{a.text}</p></article>)}
        </div>
        <div className="marketing-flow">
          <div><small>MARSHAL</small><b>Finalizes match</b></div><span>→</span>
          <div><small>TOURNAMENT</small><b>Bracket advances</b></div><span>→</span>
          <div><small>RECORDS</small><b>Rankings update</b></div><span>→</span>
          <div><small>FIGHTER</small><b>Career record updates</b></div><span>→</span>
          <div><small>PUBLIC</small><b>Audience sees result</b></div>
        </div>
        <p className="marketing-flow-note">Enter it once. Let BuhurtOS carry it everywhere else.</p>
      </section>

      <section className="marketing-section" id="features">
        <div className="marketing-feature-layout">
          <div className="marketing-feature-copy">
            <span className="eyebrow">THE FULL MEAL DEAL</span>
            <h2>Not just a bracket app.</h2>
            <p>The goal is a complete operating system for competition: before the event, during the event, after the event and across the whole season.</p>
            <Link className="show-btn primary large" to="/home">Walk through the prototype →</Link>
          </div>
          <div className="marketing-capability-grid">{capabilities.map((x,i)=><div key={x}><span>{i+1}</span><b>{x}</b></div>)}</div>
        </div>
      </section>

      <section className="marketing-record-section">
        <div className="marketing-record-copy">
          <span className="eyebrow">A REAL SPORTING RECORD</span>
          <h2>A fighter’s history should follow the fighter.</h2>
          <p>Changing teams should not erase a career. BuhurtOS is designed around permanent fighter identities with event history, category records, rankings, podiums and achievements.</p>
          <Link to="/fighters/bob">See a sample fighter profile →</Link>
        </div>
        <div className="marketing-record-card">
          <div className="marketing-record-person"><span>BM</span><div><small>HACSA FIGHTER • RANK #3</small><h3>Bob “Bear” Mercer</h3><p>Red Deer Reavers • Central Alberta</p></div></div>
          <div className="marketing-record-stats"><span><b>27–9–1</b><small>Career</small></span><span><b>73%</b><small>Win rate</small></span><span><b>6</b><small>Podiums</small></span><span><b>12</b><small>Events</small></span></div>
          <div className="marketing-record-tags"><span>Longsword</span><span>Sword & Buckler</span><span>5v5</span></div>
        </div>
      </section>

      <section className="marketing-cost" id="cost">
        <div className="marketing-cost-card">
          <span className="marketing-cost-icon">♡</span>
          <span className="eyebrow">THE COST PHILOSOPHY</span>
          <h2>Built to help the sport,<br/>not extract from it.</h2>
          <p>BuhurtOS will remain completely free while it can be operated without paid infrastructure or services. If the platform eventually requires paid hosting, storage, email, payment processing or other services, the goal is simple: charge only what is needed to keep it running.</p>
          <div className="marketing-cost-points">
            <span><b>$0 while possible</b><small>No artificial paywall just because we can.</small></span>
            <span><b>Cost recovery only</b><small>If real operating costs appear, pricing is intended to cover those costs.</small></span>
            <span><b>Transparent by design</b><small>The community should understand what it is paying for.</small></span>
          </div>
          <p className="marketing-cost-note">The prototype is currently a free development project and does not process real registrations, payments or official records.</p>
        </div>
      </section>

      <section className="marketing-cta">
        <div>
          <span className="eyebrow">SEE WHERE THIS IS GOING</span>
          <h2>Take BuhurtOS for a walk.</h2>
          <p>Switch between HACSA admin, team captain, fighter and spectator views to see how the same event can work for everyone.</p>
        </div>
        <div>
          <Link className="show-btn primary large" to="/home">Explore the prototype</Link>
          <Link className="show-btn secondary large" to="/public">Open spectator view</Link>
        </div>
      </section>
    </main>

    <footer className="marketing-footer">
      <div className="show-brand"><span className="show-brand-mark">B</span><span><b>BuhurtOS</b><small>Built for Buhurt</small></span></div>
      <p>Frontend concept prototype • Demo data • Not yet an official competition system</p>
    </footer>
  </div>;
}
