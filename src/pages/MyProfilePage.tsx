import { useState } from 'react';
import { demoFighters, demoTeams } from '../data/showcase';
import { Avatar, PageHeader, Panel, Pill } from '../components/ShowcaseUI';

export function MyProfilePage(){
  const fighter=demoFighters[0];
  const team=demoTeams.find(t=>t.id===fighter.teamId)!;
  const [editing,setEditing]=useState(false);
  return <>
    <PageHeader eyebrow="My Fighter Profile" title="Profile & identity" description="You own your personal information and public fighter identity. Team captains only manage your team membership." actions={<button className="show-btn primary" onClick={()=>setEditing(!editing)}>{editing?'Save changes':'Edit profile'}</button>}/>
    <div className="show-profile-editor">
      <Panel className="show-profile-photo-panel"><div className="show-profile-photo-edit"><Avatar initials="BM" tone="ember" size="xl"/><button className="show-btn secondary">Change profile photo</button><small>JPG or PNG • You control public visibility</small></div><div className="show-completion"><div><span>Profile completeness</span><b>88%</b></div><progress value="88" max="100"></progress></div></Panel>
      <Panel title="Public fighter profile" subtitle="Information spectators and other fighters can see"><div className="show-form-grid"><label>Display / fighter name<input disabled={!editing} defaultValue={fighter.fighterName}/></label><label>Home region<input disabled={!editing} defaultValue={fighter.region}/></label><label className="full">Bio<textarea disabled={!editing} defaultValue={fighter.bio}/></label><label>Current team<div className="show-readonly-field"><b>{team.name}</b><Pill tone="green">Confirmed</Pill></div></label><label>Preferred categories<input disabled={!editing} defaultValue={fighter.categories.join(', ')}/></label></div></Panel>
      <Panel title="Photo gallery" subtitle="Build a public sports profile with your own photos"><div className="show-gallery-editor"><article className="ember"><span>Profile</span><button>•••</button></article><article className="steel"><span>Action shot</span><button>•••</button></article><article className="blue"><span>Team photo</span><button>•••</button></article><button className="show-gallery-add"><span>＋</span><b>Add photo</b><small>Upload from device</small></button></div></Panel>
      <Panel title="Privacy" subtitle="Sensitive information is never part of the public sports profile"><div className="show-privacy-list"><label><div><b>Show home region</b><small>Display Central Alberta publicly</small></div><input type="checkbox" defaultChecked/></label><label><div><b>Show social links</b><small>Allow selected profile links</small></div><input type="checkbox" defaultChecked/></label><label><div><b>Show height / weight</b><small>Optional competition profile details</small></div><input type="checkbox"/></label><label className="locked"><div><b>Private administrative information</b><small>Legal name, email, phone, emergency and medical information</small></div><Pill>Always private</Pill></label></div></Panel>
      <Panel title="Private administrative details" subtitle="Visible only to you and specifically authorized tournament staff"><div className="show-form-grid"><label>Legal name<input disabled={!editing} defaultValue="Robert Mercer"/></label><label>Contact email<input disabled={!editing} defaultValue="bob@example.ca"/></label><label>Emergency contact<input disabled={!editing} defaultValue="Private contact on file"/></label><label>Membership ID<input disabled value="HACSA-00482"/></label></div></Panel>
    </div>
  </>;
}
