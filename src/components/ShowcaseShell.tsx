import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { previewRoleLabels, usePreviewMode, type PreviewRole } from '../features/PreviewMode';

const navByRole: Record<PreviewRole, Array<[string,string,string]>> = {
  bi_admin: [['/home','Overview','◫'],['/governance','Governance','⌘'],['/teams','Teams','♜'],['/fighters','Fighters','♟'],['/events','Events','⚔'],['/rankings','Rankings','↗'],['/rules','Rulesets','§'],['/public','Public Arena','◎']],
  hacsa_admin: [['/home','Overview','◫'],['/governance','HACSA','⌘'],['/teams','Teams','♜'],['/fighters','Fighters','♟'],['/events','Events','⚔'],['/rankings','Rankings','↗'],['/rules','Rulesets','§'],['/public','Public Arena','◎']],
  captain: [['/home','Captain Home','◫'],['/team-hq','Team HQ','♜'],['/fighters','Roster','♟'],['/events','Events','⚔'],['/rankings','Rankings','↗'],['/public','Public Arena','◎']],
  fighter: [['/home','My Home','◫'],['/me','My Profile','♟'],['/events','Events','⚔'],['/rankings','Rankings','↗'],['/teams','Teams','♜'],['/public','Public Arena','◎']],
  spectator: [['/public','Live Now','●'],['/events','Events','⚔'],['/rankings','Rankings','↗'],['/fighters','Fighters','♟'],['/teams','Teams','♜']]
};

export function ShowcaseShell(){
  const { role,setRole,roleLabel }=usePreviewMode();
  const navigate=useNavigate();
  const location=useLocation();
  const nav=navByRole[role];
  const switchRole=(next:PreviewRole)=>{
    setRole(next);
    navigate(next==='spectator'?'/public':'/home');
  };
  const activeLabel=nav.find(([to])=>location.pathname===to || (to!=='/'&&location.pathname.startsWith(to+'/')))?.[1] ?? 'BuhurtOS';
  return <div className="show-shell">
    <aside className="show-sidebar">
      <NavLink to="/home" className="show-brand"><span className="show-brand-mark">B</span><span><b>BuhurtOS</b><small>Competition operating system</small></span></NavLink>
      <div className="show-context"><span>VIEWING AS</span><strong>{roleLabel}</strong><small>Prototype mode</small></div>
      <nav className="show-nav">{nav.map(([to,label,icon])=><NavLink key={to} to={to}><span>{icon}</span><b>{label}</b></NavLink>)}</nav>
      <div className="show-side-bottom"><div className="show-org-chain"><span>BI</span><i>›</i><span>HACSA</span><i>›</i><b>Reavers</b></div><small>Demo data • Frontend preview</small></div>
    </aside>
    <main className="show-main">
      <header className="show-topbar">
        <div className="show-mobile-brand"><span className="show-brand-mark">B</span><b>{activeLabel}</b></div>
        <div className="show-top-context"><span className="show-live-dot"></span><span>HACSA Fall Open</span><small>Prototype</small></div>
        <label className="show-role-picker"><span>Preview as</span><select value={role} onChange={e=>switchRole(e.target.value as PreviewRole)}>{Object.entries(previewRoleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      </header>
      <div className="show-content"><Outlet/></div>
    </main>
    <nav className="show-bottom-nav">{nav.slice(0,5).map(([to,label,icon])=><NavLink key={to} to={to}><span>{icon}</span><small>{label}</small></NavLink>)}</nav>
  </div>;
}
