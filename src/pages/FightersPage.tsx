import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { demoFighters, demoTeams } from '../data/showcase';
import { Avatar, PageHeader, Pill } from '../components/ShowcaseUI';

export function FightersPage(){
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('all');
  const teamName=(id:string)=>demoTeams.find(t=>t.id===id)?.name??'Independent';
  const fighters=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    return demoFighters.filter(f=>{
      const matchesQuery=!needle || [f.name,f.fighterName,f.region,teamName(f.teamId)].some(value=>value.toLowerCase().includes(needle));
      const matchesCategory=category==='all' || f.categories.includes(category);
      return matchesQuery&&matchesCategory;
    });
  },[query,category]);
  return <>
    <PageHeader eyebrow="HACSA Athlete Directory" title="Fighters" description="Permanent fighter identities, public competition records and current team relationships." actions={<div className="show-filter-row"><label className="show-search"><span>⌕</span><input aria-label="Search fighters" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search fighters"/></label><select aria-label="Filter fighters by category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option><option>Longsword</option><option>Sword & Buckler</option><option>5v5</option></select></div>}/>
    {fighters.length===0?<div className="state-card">No fighters match those filters.</div>:<div className="show-fighter-grid">{fighters.map(f=><Link to={`/fighters/${f.id}`} className="show-fighter-card" key={f.id}><div className={`show-fighter-photo ${f.photoTone}`}><Avatar initials={f.name.split(' ').map(x=>x[0]).join('').slice(0,2)} tone={f.photoTone} size="xl"/><span className="show-rank-badge">#{f.rank}</span></div><div><span className="eyebrow">{teamName(f.teamId)}</span><h2>{f.fighterName}</h2><p>{f.region}</p><div className="show-fighter-record"><span><b>{f.record.wins}</b><small>Wins</small></span><span><b>{f.record.losses}</b><small>Losses</small></span><span><b>{f.podiums}</b><small>Podiums</small></span></div><div className="show-tag-row">{f.categories.slice(0,3).map(c=><Pill key={c}>{c}</Pill>)}</div></div></Link>)}</div>}
  </>;
}
