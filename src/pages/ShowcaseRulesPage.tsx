import { Link } from 'react-router-dom';
import { demoRulesets } from '../data/showcase';
import { PageHeader, Panel, Pill } from '../components/ShowcaseUI';

const formats=[['Longsword','1 min rounds','Most points wins round'],['Sword & Shield','Ruleset driven','Best-of structure'],['Sword & Buckler','First to 5','First to 2 rounds'],['Sword & Sword','Ruleset driven','Point scoring'],['Saber','Ruleset driven','Point scoring'],['Greatsword','Ruleset driven','Point scoring'],['Polearm','Ruleset driven','Point scoring'],['Long Axe','Ruleset driven','Point scoring'],['Profight','Configurable','BI / local options'],['Triathlon','Multi-weapon','Ruleset driven'],['3v3','Last team standing','Melee'],['5v5','Last team standing','Melee'],['10v10','Last team standing','Melee'],['12v12','Last team standing','Melee'],['Marathon','Best-of / timed','Endurance']];

export function ShowcaseRulesPage(){
  return <>
    <PageHeader eyebrow="Rules Engine" title="Rulesets" description="Organizations publish versioned rules. Events lock the exact version used so old results never change when future rules do." actions={<Link className="show-btn primary" to="/ops/rulesets">Open ruleset administration</Link>}/>
    <div className="show-rule-lineage"><div><span className="show-node-mark">BI</span><div><small>BASE RULES</small><b>BI International Rules 2026</b></div></div><span>→</span><div><span className="show-node-mark">H</span><div><small>LOCAL AMENDMENT</small><b>HACSA Rules 2026.3</b></div></div><span>→</span><div><span className="show-node-mark">⚔</span><div><small>EVENT LOCK</small><b>HACSA Fall Open</b></div></div></div>
    <div className="show-rule-cards">{demoRulesets.map(rule=><article key={rule.id}><div className="show-rule-top"><div><span className="eyebrow">{rule.publisher}</span><h2>{rule.name}</h2></div><Pill tone={rule.status==='Active'?'green':rule.status==='Draft'?'amber':rule.status==='Recognized'?'blue':'neutral'}>{rule.status}</Pill></div><p>{rule.base}</p><div className="show-detail-rows"><div><span>Effective</span><b>{rule.effective}</b></div><div><span>Formats</span><b>{rule.formats}</b></div><div><span>Used by events</span><b>{rule.id==='hacsa-2026-3'?'5':'—'}</b></div></div><Link className="show-btn secondary full" to="/ops/rulesets">Open ruleset</Link></article>)}</div>
    <Panel title="Competition formats" subtitle="Each format gets machine-readable scoring plus a human explanation for marshals, fighters and spectators"><div className="show-format-grid">{formats.map(([name,timing,summary])=><article key={name}><span className="show-format-icon">⚔</span><div><b>{name}</b><small>{timing}</small><p>{summary}</p></div><Link to="/ops/rulesets">Configure</Link></article>)}</div></Panel>
  </>;
}
