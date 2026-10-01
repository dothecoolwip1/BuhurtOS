import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <section style={{ display: 'grid', gap: 18, justifyItems: 'start' }}>
      <p className="eyebrow">404</p>
      <h1 style={{ fontSize: 'clamp(46px,7vw,88px)' }}>That page is not here</h1>
      <p style={{ color: 'var(--muted)', maxWidth: '52ch' }}>The link may be old or mistyped. Try the events list or look up a rule.</p>
      <div className="ctas" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link className="btn btn-ink" to="/events">See events</Link>
        <Link className="btn btn-line" to="/rules">Find a rule</Link>
      </div>
    </section>
  );
}
