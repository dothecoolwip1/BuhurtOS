import { PRO_CARD } from '../data/fixtures';

export function ProCard() {
  return (
    <>
      <div className="panel" style={{ overflow: 'hidden' }}>
        {PRO_CARD.map(b => (
          <div className="bout" key={b.no}>
            <span className="no">{b.no}</span>
            <div>
              <div className="vs"><span className={b.winner === b.a ? 'w' : ''}>{b.a}</span><i>v</i><span className={b.winner === b.b ? 'w' : ''}>{b.b}</span></div>
              <div className="src">{b.note || `${b.weight}weight · tournament fight`}</div>
            </div>
            <div className="rs"><span>{b.result}</span>{b.winner && <span className="w">Winner: {b.winner.split(' ')[1]}</span>}</div>
          </div>
        ))}
      </div>
      <p className="src" style={{ marginTop: 12 }}>Decisions use the win types in Outrance Rules §15.4: unanimous, majority and split decisions, draws, TKO and KO. Names and results here are sample data.</p>
    </>
  );
}
