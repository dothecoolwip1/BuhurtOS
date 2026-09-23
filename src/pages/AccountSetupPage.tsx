import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { completeAccountSetup } from '../lib/auth';
import { supabase } from '../lib/supabase';

export function AccountSetupPage(){
  const [displayName,setDisplayName]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [complete,setComplete]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    if(!supabase)return;
    supabase.auth.getUser().then(({data})=>{
      setReady(Boolean(data.user));
      setDisplayName(String(data.user?.user_metadata?.display_name ?? ''));
    }).catch(()=>setReady(false));
    const {data}=supabase.auth.onAuthStateChange((_event,session)=>setReady(Boolean(session?.user)));
    return()=>data.subscription.unsubscribe();
  },[]);

  if(complete)return <Navigate to="/ops" replace/>;

  const save=async()=>{
    if(password!==confirm){setMessage('Passwords do not match.');return;}
    setBusy(true);setMessage('');
    try{
      await completeAccountSetup(displayName,password);
      setComplete(true);
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to complete account setup.');}
    finally{setBusy(false);}
  };

  return <main className="auth-shell"><section className="auth-card">
    <span className="brand-mark large">B</span>
    <span className="eyebrow">BuhurtOS invitation</span>
    <h1>Finish account setup</h1>
    <p>{ready?'Set your display name and password. Event access from your invitation will already be attached to this account.':'Open this page from your BuhurtOS invitation email.'}</p>
    <label>Display name<input autoComplete="name" value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>
    <label>Password<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
    <label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
    {message&&<div className="auth-message">{message}</div>}
    <button className="primary big" disabled={busy||!ready||displayName.trim().length<2||password.length<10||!confirm} onClick={save}>Complete Setup</button>
  </section></main>;
}
