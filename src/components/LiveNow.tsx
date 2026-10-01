import { NOW_LABEL, buildNowAndNext } from '../lib/liveView';
import type { CompetitionMatch } from '../data/matches';

/** "Now and next" per field. Renders nothing when no match is active, in the hole or on deck. */
export function LiveNow({ matches, competitionNames }: { matches: readonly CompetitionMatch[]; competitionNames: ReadonlyMap<string, string> }) {
  const fields = buildNowAndNext(matches, competitionNames);
  if (fields.length === 0) return null;
  return (
    <section className="panel info live-now" aria-labelledby="now-h" aria-live="polite">
      <h2 id="now-h" style={{ fontSize: 24 }}>Now and next</h2>
      <div className="live-fields">
        {fields.map(f => (
          <div key={f.field} className="live-field">
            <div className="eyebrow">{f.field}</div>
            <ul>
              {f.items.map(i => (
                <li key={i.id} className={`slot ${i.state === 'active' ? 'now' : ''}`.trim()}>
                  <span className="k">{NOW_LABEL[i.state]}</span>
                  <span className="t"><b>{i.nameA}</b> vs <b>{i.nameB}</b><br /><i>{i.competition} · {i.round}</i></span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
