import { useEffect, useState } from 'react';
import { useAppState } from '../features/AppState';
import type { DisciplineCard } from '../types';
import { supabase } from '../lib/supabase';

const DEMO_KEY = 'buhurtos-demo-discipline';
const demoSeed: DisciplineCard[] = [{ id: 'dc-1', eventId: 'event-hacsa-demo', seasonId: 'season-2026', rosterEntryId: 'r3', color: 'yellow', reason: 'Unsafe strike warning', notes: 'First warning', issuedAt: '2026-09-20T16:40:00.000Z' }];

export function DisciplinePage() {
  const { event, roster, user } = useAppState();
  const [cards, setCards] = useState<DisciplineCard[]>([]);
  const [form, setForm] = useState({ rosterEntryId: '', color: 'yellow' as 'yellow'|'red', reason: '', notes: '' });
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!event) return;
    if (!supabase) {
      const stored = localStorage.getItem(DEMO_KEY);
      setCards(stored ? JSON.parse(stored) : demoSeed);
      return;
    }
    supabase.from('disciplinary_cards').select('*').eq('season_id', event.seasonId).order('issued_at', { ascending: false }).then(({ data, error }) => {
      if (error) return setMessage(error.message);
      setCards((data ?? []).map((c:any) => ({ id:c.id,eventId:c.event_id,seasonId:c.season_id,matchId:c.match_id??undefined,fighterId:c.fighter_id??undefined,rosterEntryId:c.roster_entry_id??undefined,color:c.color,reason:c.card_reason,notes:c.notes??undefined,issuedAt:c.issued_at })));
    });
  }, [event?.id]);
  if (!event) return null;
  const save = async () => {
    if (!form.rosterEntryId || !form.reason.trim()) return;
    const entry = roster.find(r => r.id === form.rosterEntryId);
    const card: DisciplineCard = { id: crypto.randomUUID(), eventId:event.id, seasonId:event.seasonId, rosterEntryId:entry?.id, fighterId:entry?.fighterId, color:form.color, reason:form.reason.trim(), notes:form.notes.trim() || undefined, issuedAt:new Date().toISOString() };
    if (!supabase) {
      const next=[card,...cards]; setCards(next); localStorage.setItem(DEMO_KEY,JSON.stringify(next));
    } else {
      const { error } = await supabase.from('disciplinary_cards').insert({ organization_id:event.organizationId,season_id:event.seasonId,event_id:event.id,roster_entry_id:card.rosterEntryId,fighter_id:card.fighterId??null,color:card.color,card_reason:card.reason,notes:card.notes??null,issued_by:user?.userId??null });
      if (error) return setMessage(error.message);
      setCards([card,...cards]);
    }
    setForm({ rosterEntryId:'',color:'yellow',reason:'',notes:'' }); setMessage('Card recorded in the season history.');
  };
  const name=(id?:string)=>roster.find(r=>r.id===id)?.displayName??'Unknown fighter';
  return <><section className="section-head"><div><span className="eyebrow">Season discipline</span><h1>Cards & Warnings</h1><p>Cards stay tied to both the event and season so repeat issues can be reviewed across events.</p></div></section><div className="admin-grid"><section className="panel-card"><h2>Issue card</h2><div className="form-stack"><label>Competitor<select value={form.rosterEntryId} onChange={e=>setForm(f=>({...f,rosterEntryId:e.target.value}))}><option value="">Choose competitor</option>{roster.filter(r=>r.fighterId).map(r=><option key={r.id} value={r.id}>{r.displayName}</option>)}</select></label><label>Card<select value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value as 'yellow'|'red'}))}><option value="yellow">Yellow</option><option value="red">Red</option></select></label><label>Reason<input value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))}/></label><label>Notes<textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></label><button className="primary big" onClick={save}>Record Card</button></div></section><section className="panel-card"><h2>Season history</h2><div className="discipline-list">{cards.map(card=><article key={card.id}><span className={`card-dot ${card.color}`}></span><div><b>{name(card.rosterEntryId)}</b><p>{card.reason}</p><small>{new Date(card.issuedAt).toLocaleString()}</small></div></article>)}</div></section></div>{message&&<div className="auth-message">{message}</div>}</>;
}
