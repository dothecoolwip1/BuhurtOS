import { useState } from 'react';
import { demoTeams } from '../data/showcase';
import { PageHeader, Panel, Pill, StatCard } from '../components/ShowcaseUI';

export function GovernancePage(){
  const [showCreate,setShowCreate]=useState(false);
  return <>
    <PageHeader eyebrow="Governance" title="BI → HACSA" description="Federation relationship, organization administration, sanctioned teams and delegated authority." actions={<button className="show-btn primary" onClick={()=>setShowCreate(true)}>＋ Start a team</button>}/>
    <div className="show-stat-grid">
      <StatCard label="Parent federation" value="BI" note="Buhurt International" tone="accent"/>
      <StatCard label="Organization" value="HACSA" note="Active • Canada" tone="good"/>
      <StatCard label="Teams" value={demoTeams.length} note="3 active • 1 forming"/>
      <StatCard label="Current ruleset" value="2026.3" note="BI based • HACSA amendments"/>
    </div>
    <div className="show-two-col">
      <Panel title="Organization hierarchy" subtitle="Who governs what — without losing historical relationships">
        <div className="show-org-tree">
          <article className="level federation"><span className="show-node-mark">BI</span><div><small>GOVERNING BODY</small><h3>Buhurt International</h3><p>International rules authority and federation relationship.</p></div><Pill tone="blue">Active</Pill></article>
          <div className="show-tree-line"></div>
          <article className="level organization"><span className="show-node-mark">H</span><div><small>ORGANIZATION</small><h3>HACSA</h3><p>Teams, seasons, sanctioned events, records and local rules.</p></div><Pill tone="green">Active</Pill></article>
          <div className="show-tree-line fan"></div>
          <div className="show-tree-teams">{demoTeams.map(t=><article key={t.id}><span className="show-node-mark" style={{borderColor:t.color}}>{t.logoText}</span><b>{t.name}</b><small>{t.members} members</small></article>)}</div>
        </div>
      </Panel>
      <Panel title="Authority & relationships" subtitle="Flexible enough for future federations, historical bodies and local rules">
        <div className="show-relation-list">
          <article><span>Federation affiliation</span><b>HACSA → BI</b><Pill tone="green">Current</Pill></article>
          <article><span>Primary rules basis</span><b>BI International Rules 2026</b><Pill tone="blue">Recognized</Pill></article>
          <article><span>Local amendment</span><b>HACSA 2026.3</b><Pill tone="green">Active</Pill></article>
          <article><span>Historical reference</span><b>IMCF Rules 2025</b><Pill>Historical</Pill></article>
        </div>
      </Panel>
    </div>
    <Panel title="Team approvals" subtitle="Organizations create, approve and retain ownership of team records">
      <div className="show-table-wrap"><table className="show-table"><thead><tr><th>Team</th><th>Region</th><th>Captain</th><th>Members</th><th>Status</th><th></th></tr></thead><tbody>{demoTeams.map(t=><tr key={t.id}><td><strong>{t.name}</strong></td><td>{t.region}</td><td>{t.captain}</td><td>{t.members}</td><td><Pill tone={t.status==='active'?'green':'amber'}>{t.status}</Pill></td><td><button className="show-link-btn">Manage</button></td></tr>)}</tbody></table></div>
    </Panel>
    {showCreate?<div className="show-modal-backdrop" onMouseDown={e=>e.currentTarget===e.target&&setShowCreate(false)}><section className="show-modal"><div className="show-modal-head"><div><span className="eyebrow">HACSA TEAM CREATION</span><h2>Start a new team</h2></div><button onClick={()=>setShowCreate(false)}>×</button></div><div className="show-form-grid"><label>Team name<input placeholder="e.g. Red Deer Reavers"/></label><label>Short name<input placeholder="RDR"/></label><label>Home city<input placeholder="Red Deer, AB"/></label><label>Region<input placeholder="Central Alberta"/></label><label className="full">Public description<textarea placeholder="Tell fighters and spectators about the team…"/></label><label>Initial captain<input placeholder="Search member or enter email"/></label><label>Status<select><option>Forming</option><option>Active</option></select></label></div><div className="show-modal-actions"><button className="show-btn secondary" onClick={()=>setShowCreate(false)}>Cancel</button><button className="show-btn primary" onClick={()=>setShowCreate(false)}>Create team</button></div></section></div>:null}
  </>;
}
