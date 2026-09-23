import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAppState } from '../features/AppState';
import { sendMagicLink, signIn } from '../lib/auth';
import { configurationError, isSupabaseConfigured } from '../lib/supabase';

export function LoginPage() {
  const { user } = useAppState();
  const location = useLocation();
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  if(user)return <Navigate to={'/ops'+location.search} replace/>;

  if(!isSupabaseConfigured){
    return <main className="auth-shell"><section className="auth-card">
      <span className="brand-mark large">B</span>
      <span className="eyebrow">BuhurtOS</span>
      <h1>Operations are not configured</h1>
      <p>{configurationError}</p>
      <Link className="button-link" to="/">Return to platform home</Link>
    </section></main>;
  }

  const run=async(action:'password'|'magic')=>{
    setBusy(true);setMessage('');
    try{
      if(action==='password')await signIn(email,password);
      else await sendMagicLink(email);
      setMessage(action==='magic'?'Magic link sent. Check your email.':'Signed in.');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Sign in failed.');
    }finally{setBusy(false);}
  };

  return <main className="auth-shell"><section className="auth-card">
    <span className="brand-mark large">B</span>
    <span className="eyebrow">BuhurtOS</span>
    <h1>Field Sign In</h1>
    <p>Use your tournament account. Public event pages never require a login.</p>
    <label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {message&&<div className="auth-message">{message}</div>}
    <button className="primary big" disabled={busy||!email||!password} onClick={()=>run('password')}>Sign In</button>
    <button className="big" disabled={busy||!email} onClick={()=>run('magic')}>Email Magic Link</button>
    <Link className="auth-text-link" to="/ops/recover?mode=request">Forgot password?</Link>
  </section></main>;
}
