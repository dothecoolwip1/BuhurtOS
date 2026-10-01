import { useSearchParams } from 'react-router-dom';
import { Seg } from '../components/ui';
import { RULES, type RuleGroup } from '../content/rules';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type G = 'all' | RuleGroup;
const GROUPS: readonly (readonly [G, string])[] = [['all', 'All'], ['buhurt', 'Group fight'], ['duels', 'Duels'], ['outrance', 'Profight'], ['tournaments', 'Tournaments'], ['safety', 'Safety']];

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}

export function RulesPage() {
  useDocumentTitle('Rules');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const rawG = params.get('g');
  const group: G = GROUPS.some(([k]) => k === rawG) ? (rawG as G) : 'all';
  const needle = q.trim().toLowerCase();
  const hits = RULES.filter(r => (group === 'all' || r.group === group) && (!needle || `${r.title} ${r.kind} ${r.body} ${r.keywords ?? ''}`.toLowerCase().includes(needle)));
  const set = (next: { q?: string; g?: G }) => {
    const p = new URLSearchParams(params);
    if (next.q !== undefined) { if (next.q) p.set('q', next.q); else p.delete('q'); }
    if (next.g !== undefined) { if (next.g !== 'all') p.set('g', next.g); else p.delete('g'); }
    setParams(p, { replace: true });
  };
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22, maxWidth: 860, margin: '0 auto' }}>
      <div><p className="eyebrow">Rules lookup</p><h1 style={{ fontSize: 'clamp(46px,7vw,88px)', marginTop: 10 }}>Find a rule fast</h1>
        <p style={{ color: 'var(--muted)', marginTop: 12, fontSize: 17 }}>Built for the side of the list: type a few words, get the answer with its document, section and version.</p></div>
      <label className="rulesearch">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--faint)' }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input value={q} onChange={e => set({ q: e.target.value })} placeholder="Try “grounded”, “longsword”, “10-point”, “tiebreak”" aria-label="Search rules" />
      </label>
      <Seg label="Format" value={group} options={GROUPS} onChange={g => set({ g })} />
      <div style={{ display: 'grid', gap: 12 }}>
        {hits.length ? hits.map(r => (
          <article className="panel rule" key={r.title}>
            <div className="rt"><span className="eyebrow">{r.kind}</span><span className="chip steel">{r.doc} · {r.section}</span></div>
            <h3><Highlight text={r.title} q={needle} /></h3>
            <p><Highlight text={r.body} q={needle} /></p>
          </article>
        )) : <div className="panel rule"><h3>No rule matches “{q}”</h3><p>Try a shorter word, or switch the format filter.</p></div>}
      </div>
      <p className="src">Summaries paraphrase Buhurt International documents (versions shown on each result). They are not the official text; check the source document before relying on one, and a ruleset may be changed by the event's regulations.</p>
    </section>
  );
}
