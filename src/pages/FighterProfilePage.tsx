import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { demoEvents, demoFighters, demoTeams } from '../data/showcase';
import { Avatar, Panel, Pill } from '../components/ShowcaseUI';
import { shareCurrentPage } from '../lib/share';

export function FighterProfilePage(){
  const {fighterId='bob'}=useParams();
  const fighter=demoFighters.find(f=>f.id===fighterId)??demoFighters[0];
  const team=demoTeams.find(t=>t.id===fighter.teamId)!;
  const total=fighter.record.wins+fighter.record.losses+fighter.record.draws;
  const winRate=total?Math.round((fighter.record.wins/total)*100):0;
  const [shareMessage,setShareMessage]=useState('');
  const share=async()=>{
    try{
      const result=await shareCurrentPage(fighter.fighterName,fighter.bio);
      setShareMessage(result==='copied'?'Fighter link copied.':'Fighter profile shared.');
    }catch(error){
      setShareMessage(error instanceof Error?error.message:'Unable to share this profile.');
    }
  };
  return <>
    <div className={`show-profile-hero fighter ${fighter.photoTone}`}><Avatar initials={fighter.name.split(' ').map(x=>x[0]).join('').slice(0,2)} tone={fighter.photoTone} size="xl"/><div className="grow"><span className="eyebrow">HACSA FIGHTER • RANK #{fighter.rank}</span><h1>{fighter.fighterName}</h1><p><Link to={`/teams/${team.id}`}>{team.name}</Link> • {fighter.region}</p><div className="show-inline-pills"><Pill tone="green">{fighter.status}</Pill>{fighter.categories.map(c=><Pill key={c}>{c}</Pill>)}</div></div><button className="show-btn secondary" onClick={share}>Share profile</button></div>
    {shareMessage&&<div className="auth-message">{shareMessage}</div>}
    <div className="show-record-strip"><div><strong>{fighter.record.wins}–{fighter.record.losses}–{fighter.record.draws}</strong><span>Career record</span></div><div><strong>{winRate}%</strong><span>Win rate</span></div><div><strong>{fighter.podiums}</strong><span>Podiums</span></div><div><strong>{fighter.events}</strong><span>Events</span></div><div><strong>#{fighter.rank}</strong><span>HACSA rank</span></div></div>
    <div className="show-two-col wide-left">
      <div className="show-stack">
        <Panel title="Fighter bio"><p className="show-long-copy">{fighter.bio}</p></Panel>
        <Panel title="Recent results"><div className="show-results-list"><article><div><span className="show-result-icon win">W</span><div><b>vs. Alex Morgan</b><small>Longsword • HACSA Spring Open • Final</small></div></div><strong>8–5</strong></article><article><div><span className="show-result-icon win">W</span><div><b>vs. Mason Clarke</b><small>Longsword • HACSA Spring Open • Semifinal</small></div></div><strong>7–4</strong></article><article><div><span className="show-result-icon loss">L</span><div><b>vs. Kolby H.</b><small>Longsword • Prairie Cup • Final</small></div></div><strong>5–7</strong></article></div></Panel>
        <Panel title="Achievements"><div className="show-achievement-grid">{fighter.achievements.map((a,i)=><article key={a}><span>{i===0?'★':i===1?'◆':'⚔'}</span><b>{a}</b></article>)}</div></Panel>
      </div>
      <div className="show-stack">
        <Panel title="2026 season"><div className="show-record-big"><strong>{fighter.seasonRecord.wins}–{fighter.seasonRecord.losses}–{fighter.seasonRecord.draws}</strong><span>Current season</span></div><div className="show-detail-rows"><div><span>Longsword</span><b>#{fighter.rank}</b></div><div><span>Points</span><b>790</b></div><div><span>Best finish</span><b>Gold</b></div></div></Panel>
        <Panel title="Upcoming"><div className="show-upcoming-mini"><span className="show-date-tile"><b>SEP</b><small>26</small></span><div><b>{demoEvents[0].name}</b><small>Longsword • Sword & Buckler • 5v5</small></div></div><Link className="show-btn primary full" to="/events/fall-open">View event</Link></Panel>
        <Panel title="Gallery"><div className="show-gallery-mini"><span className={fighter.photoTone}>Action</span><span className="steel">Podium</span><span className="blue">Team</span><span className="ember">Armor</span></div></Panel>
      </div>
    </div>
  </>;
}
