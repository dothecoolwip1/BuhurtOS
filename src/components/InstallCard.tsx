import { useLocation } from 'react-router-dom';
import { useInstall } from '../lib/install';
import { installHelp, quietRoute } from '../lib/pushSupport';

/**
 * "Install BuhurtOS": the browser's own install dialog where there is one, short Share → Add to Home Screen steps on iPhone and iPad, nothing
 * anywhere else. A "Not now" is remembered for weeks, an installed app never sees it, and it never appears while scoring or running an event.
 */
export function InstallCard() {
  const { pathname, search } = useLocation();
  const i = useInstall();
  if (!i.offer || quietRoute(pathname, search)) return null;
  const help = installHelp(i.platform);
  return (
    <section className="panel info" aria-label="Install BuhurtOS" style={{ display: 'grid', gap: 8 }}>
      <b>{i.native ? 'Install BuhurtOS on this device' : help.title}</b>
      <span className="muted">Opens like an app, and lets BuhurtOS tell you when you are coming up to fight.</span>
      {!i.native && <ol className="plain" style={{ margin: 0, paddingLeft: 20 }}>{help.steps.map(s => <li key={s}>{s}</li>)}</ol>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {i.native && <button type="button" className="btn btn-ink btn-sm" onClick={() => void i.install()}>Install</button>}
        <button type="button" className="btn btn-line btn-sm" onClick={i.dismiss}>{i.native ? 'Not now' : 'Got it'}</button>
      </div>
    </section>
  );
}
