import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crest } from '../components/Crest';
import { Seg } from '../components/ui';
import { TEAMS } from '../data/fixtures';
import { DuelBoard, GroupBoard, ProBoard } from '../components/ScoreBoards';
import { newDuel, newGroupFight, newPro, toggleFighter, type DuelState, type GroupState, type ProState } from '../lib/scoring';
import type { Side } from '../lib/tournament';
import { link, useOutbox } from '../lib/useOutbox';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Mode = 'group' | 'duel' | 'pro';
const MODES: readonly (readonly [Mode, string])[] = [['group', 'Group fight'], ['duel', 'Duel'], ['pro', 'Profight']];
const HEADINGS: Record<Mode, [string, string]> = { group: ['Group fight · Field 1', 'Semifinal 1'], duel: ['Duels · Field 2', 'Longsword · Pool B'], pro: ['Profight · line marshal', 'Heavyweight · Bout 3'] };

function SyncBar({ waiting }: { waiting: number }) {
  const [off, setOff] = useState(link.simulatedOffline);
  return (
    <div className="syncbar" role="status">
      <span className={`chip ${waiting ? 'brass' : 'win'}`}>{waiting ? `${waiting} saved on this device, waiting for signal` : 'All saved and synced'}</span>
      <label className="chk"><input type="checkbox" checked={off} onChange={e => { link.set(e.target.checked); setOff(e.target.checked); }} /> Pretend there is no signal (preview only)</label>
    </div>
  );
}

type Record_ = (kind: string, subject: string, payload: unknown) => Promise<void>;

/** Sample preview: invented fixtures on the shared boards. Nothing here reaches the database. */
function PreviewGroup({ record }: { record: Record_ }) {
  const [s, setS] = useState<GroupState>(() => {
    let g = newGroupFight();
    g = toggleFighter(toggleFighter(g, 'a', 2), 'a', 3);
    return [0, 2, 4].reduce((acc, i) => toggleFighter(acc, 'b', i), g);
  });
  const ids: Record<Side, 'ironwardens' | 'northgate'> = { a: 'ironwardens', b: 'northgate' };
  if (s.winner) {
    const t = TEAMS[ids[s.winner]];
    return (
      <div className="panel mboard" style={{ textAlign: 'center', justifyItems: 'center' }}>
        <Crest team={t} size={80} /><span className="chip win">Fight result saved</span>
        <h2 style={{ fontSize: 40 }}>{t.name} win {s.rounds[s.winner]}–{s.rounds[s.winner === 'a' ? 'b' : 'a']}</h2>
        <p style={{ color: 'var(--muted)' }}>They go through to the final on Sunday, Field 1.</p>
        <button type="button" className="btn btn-line" onClick={() => setS(newGroupFight())}>Score another fight</button>
      </div>
    );
  }
  return <GroupBoard state={s} onChange={setS} record={(k, p) => void record(k, 'sf1', p)} names={{ a: TEAMS.ironwardens.name, b: TEAMS.northgate.name }} crest={side => <Crest team={TEAMS[ids[side]]} size={52} />} />;
}

function PreviewDuel({ record }: { record: Record_ }) {
  const [s, setS] = useState<DuelState>(newDuel);
  return (
    <>
      <DuelBoard state={s} onChange={setS} record={(k, p) => void record(k, 'ls-b3', p)} names={{ a: 'Mara Kessling', b: 'Ines Duarte' }} subs={{ a: 'Iron Wardens', b: 'Cold Harbor Guard' }} />
      {s.winner && <button type="button" className="btn btn-line" style={{ width: '100%' }} onClick={() => setS(newDuel())}>Start a new match</button>}
    </>
  );
}

function PreviewPro({ record }: { record: Record_ }) {
  const [s, setS] = useState<ProState>(newPro);
  return <ProBoard state={s} onChange={setS} record={(k, p) => void record(k, 'hw-3', p)} names={{ a: 'Coll MacRae', b: 'Dane Holloway' }} subs={{ a: 'Saltmarsh Lions', b: 'Northgate Co.' }} />;
}

export function MarshalPage() {
  useDocumentTitle('Marshal scoring');
  const [params, setParams] = useSearchParams();
  const mode: Mode = MODES.find(([k]) => k === params.get('mode'))?.[0] ?? 'group';
  const { waiting, record } = useOutbox({ preview: true });
  return (
    <section className="marshal fade-in">
      <SyncBar waiting={waiting} />
      <Seg label="Format" value={mode} options={MODES} onChange={m => setParams({ mode: m }, { replace: true })} />
      <div className="mhead"><div><p className="eyebrow">{HEADINGS[mode][0]}</p><h1 style={{ fontSize: 40, marginTop: 6 }}>{HEADINGS[mode][1]}</h1></div></div>
      <div style={{ display: 'grid', gap: 14 }} key={mode}>
        {mode === 'group' && <PreviewGroup record={record} />}
        {mode === 'duel' && <PreviewDuel record={record} />}
        {mode === 'pro' && <PreviewPro record={record} />}
      </div>
      <p className="src" style={{ textAlign: 'center' }}>Every tap is saved on this device first and sent when there is signal. Nothing is lost if the page closes.</p>
    </section>
  );
}
