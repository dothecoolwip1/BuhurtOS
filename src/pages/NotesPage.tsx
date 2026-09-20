import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { supabase } from '../lib/supabase';

type Note = { id:string; matchId:string; teamId?:string; visibility:'private'|'team_only'|'marshal_visible'; body:string; createdAt:string };
const KEY='buhurtos-demo-notes';

export function NotesPage(){
  const {event,matches,roster,user}=useAppState();
  const [notes,setNotes]=useState<Note[]>([]);
  const [matchId,setMatchId]=useState('');
  const [teamId,setTeamId]=useState('');
  const [visibility,setVisibility]=useState<Note['visibility']>('private');
  const [body,setBody]=useState('');
  const [message,setMessage]=useState('');
  const captainTeam = event ? user?.eventRoles.find(role => role.eventId === event.id && role.role === 'team_captain')?.teamId : undefined;
  const teamOptions = useMemo(() => {
    const ids = [...new Set(roster.map(entry => entry.teamId).filter((id): id is string => Boolean(id)))];
    return ids.map(id => ({ id, label: roster.filter(entry => entry.teamId === id).slice(0,2).map(entry => entry.displayName).join(', ') || `Team ${id.slice(0,8)}` }));
  }, [roster]);

  useEffect(()=>{
    if(!event)return;
    if(!supabase){const s=localStorage.getItem(KEY);setNotes(s?JSON.parse(s):[]);return;}
    supabase.from('fight_notes').select('*').eq('event_id',event.id).order('created_at',{ascending:false}).then(({data,error})=>{
      if(error)setMessage(error.message);
      else setNotes((data??[]).map((n:any)=>({id:n.id,matchId:n.match_id,teamId:n.team_id??undefined,visibility:n.visibility,body:n.note_body,createdAt:n.created_at})));
    });
  },[event?.id]);

  useEffect(() => {
    if (visibility === 'team_only' && !teamId && captainTeam) setTeamId(captainTeam);
  }, [visibility, teamId, captainTeam]);

  if(!event)return null;
  const save=async()=>{
    if(!matchId||!body.trim()||!user)return;
    if(visibility === 'team_only' && !teamId) return setMessage('Choose the team this note belongs to.');
    const note:Note={id:crypto.randomUUID(),matchId,teamId:visibility === 'team_only' ? teamId : undefined,visibility,body:body.trim(),createdAt:new Date().toISOString()};
    if(!supabase){const next=[note,...notes];setNotes(next);localStorage.setItem(KEY,JSON.stringify(next));}
    else{
      const {error}=await supabase.from('fight_notes').insert({event_id:event.id,match_id:matchId,author_user_id:user.userId,team_id:note.teamId??null,visibility,note_body:body.trim()});
      if(error)return setMessage(error.message);
      setNotes([note,...notes]);
    }
    setBody('');setMessage('Note saved with its visibility rule.');
  };
  return <><section className="section-head"><div><span className="eyebrow">Captain and marshal records</span><h1>Fight Notes</h1><p>Private, team-only, and marshal-visible notes remain separated by team-scoped RLS.</p></div></section><div className="admin-grid"><section className="panel-card"><h2>New note</h2><div className="form-stack"><label>Match<select value={matchId} onChange={e=>setMatchId(e.target.value)}><option value="">Choose match</option>{matches.map(m=><option value={m.id} key={m.id}>{m.label}</option>)}</select></label><label>Visibility<select value={visibility} onChange={e=>setVisibility(e.target.value as Note['visibility'])}><option value="private">Private</option><option value="team_only">Team only</option><option value="marshal_visible">Marshal visible</option></select></label>{visibility === 'team_only' && <label>Team<select value={teamId} disabled={Boolean(captainTeam)} onChange={e=>setTeamId(e.target.value)}><option value="">Choose team</option>{teamOptions.map(team=><option key={team.id} value={team.id}>{team.label}</option>)}</select></label>}<label>Note<textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Tactical or operational note"/></label><button className="primary big" onClick={save}>Save Note</button></div></section><section className="panel-card"><h2>Visible notes</h2><div className="announcement-list">{notes.map(n=><article key={n.id}><b>{matches.find(m=>m.id===n.matchId)?.label??'Match'} • {n.visibility.replaceAll('_',' ')}</b><p>{n.body}</p><small>{new Date(n.createdAt).toLocaleString()}</small></article>)}</div></section></div>{message&&<div className="auth-message">{message}</div>}</>;
}
