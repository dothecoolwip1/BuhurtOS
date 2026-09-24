import { Link } from 'react-router-dom';
import { demoFighters, demoTeams } from '../data/showcase';
import { Avatar, PageHeader, Panel, Pill } from '../components/ShowcaseUI';

export function MyProfilePage(){
  const fighter=demoFighters[0];
  const team=demoTeams.find(t=>t.id===fighter.teamId)!;
  return <>
    <PageHeader eyebrow="My Fighter Profile" title="Profile & identity" description="This public-facing preview is read-only. Personal and private profile changes are made in the secured identity editor." actions={<Link className="show-btn primary" to="/ops/identity">Open profile editor</Link>}/>
    <div className="show-profile-editor">
      <Panel className="show-profile-photo-panel"><div className="show-profile-photo-edit"><Avatar initials="BM" tone="ember" size="xl"/><Link className="show-btn secondary" to="/ops/identity">Manage profile photo</Link><small>JPG or PNG • You control public visibility</small></div><div className="show-completion"><div><span>Profile completeness</span><b>88%</b></div><progress value="88" max="100"></progress></div></Panel>
      <Panel title="Public fighter profile" subtitle="Information spectators and other fighters can see"><div className="show-form-grid"><label>Display / fighter name<input disabled value={fighter.fighterName}/></label><label>Home region<input disabled value={fighter.region}/></label><label className="full">Bio<textarea disabled value={fighter.bio}/></label><label>Current team<div className="show-readonly-field"><b>{team.name}</b><Pill tone="green">Confirmed</Pill></div></label><label>Preferred categories<input disabled value={fighter.categories.join(', ')}/></label></div></Panel>
      <Panel title="Photo gallery" subtitle="Public gallery preview"><div className="show-gallery-editor"><article className="ember"><span>Profile</span></article><article className="steel"><span>Action shot</span></article><article className="blue"><span>Team photo</span></article><Link className="show-gallery-add" to="/ops/identity"><span>＋</span><b>Manage photos</b><small>Open secured editor</small></Link></div></Panel>
      <Panel title="Privacy" subtitle="Sensitive information is never part of the public sports profile"><div className="show-privacy-list"><label><div><b>Show home region</b><small>Display Central Alberta publicly</small></div><input type="checkbox" checked readOnly/></label><label><div><b>Show social links</b><small>Allow selected profile links</small></div><input type="checkbox" checked readOnly/></label><label><div><b>Show height / weight</b><small>Optional competition profile details</small></div><input type="checkbox" readOnly/></label><label className="locked"><div><b>Private administrative information</b><small>Legal name, email, phone, emergency and medical information</small></div><Pill>Always private</Pill></label></div></Panel>
      <Panel title="Private administrative details" subtitle="Placeholder preview only. Real private data is never embedded in this public showcase."><div className="state-card">Open the secured identity editor to view or update private administrative information.</div></Panel>
    </div>
  </>;
}
