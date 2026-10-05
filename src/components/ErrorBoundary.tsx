import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; /** When this changes (for example the address), a screen that failed gets a fresh try. */ resetKey?: string; fullPage?: boolean }
interface State { error: Error | null }

/**
 * Keeps one screen's failure from taking the whole app down. Without it, an error thrown while rendering or in an effect unmounts everything
 * React drew and leaves an empty page with no way back. Here the header and menus stay, the screen says plainly that it failed, and offers to
 * try again or reload. It does not hide anything: the error is logged to the console for the bug report.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Screen failed:', error, info.componentStack); }

  componentDidUpdate(prev: Props) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section role="alert" className="panel info" data-testid="screen-error"
        style={{ display: 'grid', gap: 10, maxWidth: 560, margin: this.props.fullPage ? '48px auto' : '16px 0', padding: 18 }}>
        <h2 style={{ margin: 0 }}>This screen ran into a problem</h2>
        <p style={{ margin: 0 }}>Nothing you saved is lost. Try again, or reload BuhurtOS. If it keeps happening, report it with the bug button.</p>
        <p className="src" style={{ margin: 0, overflowWrap: 'anywhere' }}>{String(error.message || error).slice(0, 200)}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ink" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" className="btn btn-line" onClick={() => window.location.reload()}>Reload BuhurtOS</button>
        </div>
      </section>
    );
  }
}
