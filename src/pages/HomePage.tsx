import { Link } from 'react-router-dom';
import { Crest } from '../components/Crest';
import { EventRow } from '../components/EventRow';
import { TeamCard } from '../components/TeamCard';
import { Chip, Pips } from '../components/ui';
import { LEAGUES } from '../content/leagues';
import { EVENTS, MOVES, TEAMS } from '../data/fixtures';
import { RankTable } from '../components/RankTable';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { LeagueIcon } from '../components/LeagueIcon';

function LiveCard() {
  return (
    <Link className="panel livecard fade-in" to="/events/prairie-steel-open" style={{ animationDelay: '.08s' }}>
      <div className="temper" style={{ position: 'absolute', left: 0, right: 0, top: 0, borderRadius: 0 }} />
      <div className="row"><span className="chip live">Live · Field 1</span><span className="eyebrow">Semifinal · 5v5 · Round 3</span></div>
      <div className="versus">
        <div className="side"><Crest team={TEAMS.ironwardens} size={64} /><div><div className="name">Iron Wardens</div><div className="from">Calgary, AB</div></div><Pips up={3} /></div>
        <div className="bigscore mono" role="img" aria-label="Rounds 1 to 1"><span>1</span><span className="dash">–</span><span>1</span></div>
        <div className="side"><Crest team={TEAMS.northgate} size={64} /><div><div className="name">Northgate Co.</div><div className="from">Kamloops, BC</div></div><Pips up={2} /></div>
      </div>
      <p className="pipnote" style={{ textAlign: 'center' }}>FIGHTERS STILL STANDING · ROUNDS WON SHOWN CENTRE</p>
      <div className="foot"><span>Prairie Steel Open</span><span>On deck: <b>Grey Fen v Saltmarsh</b></span></div>
    </Link>
  );
}

export function HomePage() {
  useDocumentTitle('BuhurtOS');
  return (
    <>
      <section className="hero fade-in">
        <div>
          <p className="eyebrow">Armored combat, in one place</p>
          <h1 style={{ marginTop: 14 }}>Every list.<br />Every fight.<br /><span className="t">Every result.</span></h1>
          <p className="lede">Group fights, duels and profights. Find events near you, follow the bracket, and look up the rule while the fight is still on.</p>
          <div className="ctas"><Link className="btn btn-ink" to="/events/prairie-steel-open">Follow the Prairie Steel Open</Link><Link className="btn btn-line" to="/formats">How each style works</Link></div>
        </div>
        <LiveCard />
      </section>

      <section className="section">
        <div className="section-head"><h2>Pick your fight</h2><Link className="more" to="/formats">All formats and tournament tiers →</Link></div>
        <div className="lg-cards">
          {LEAGUES.map(l => (
            <Link key={l.id} className="lgcard" to={`/formats?lg=${l.id}`}>
              <span className="ic"><LeagueIcon id={l.id} /></span>
              <div><p className="eyebrow">{l.tag}</p><h3 style={{ marginTop: 6 }}>{l.name}</h3></div>
              <p>{l.summary}</p>
              <div className="cats">{l.categories.map(c => <Chip key={c}>{c}</Chip>)}</div>
              <span className="go">How it works →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Coming up</h2><Link className="more" to="/events">All events →</Link></div>
        <div className="eventlist">{EVENTS.slice(0, 4).map(e => <EventRow key={e.id} e={e} />)}</div>
      </section>

      <section className="section grid-2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="section-head"><h2>Men's 5v5 standings</h2></div>
          <RankTable teamIds={['ironwardens', 'northgate', 'greyfen', 'saltmarsh', 'ravenmoor']} moves={MOVES} />
        </div>
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="section-head"><h2>Teams</h2></div>
          <div style={{ display: 'grid', gap: 10 }}>{['ironwardens', 'northgate', 'saltmarsh', 'greyfen'].map(id => <TeamCard key={id} team={TEAMS[id]} />)}</div>
        </div>
      </section>
    </>
  );
}
