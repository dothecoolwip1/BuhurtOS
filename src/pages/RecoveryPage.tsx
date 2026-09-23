import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { requestPasswordReset, updatePassword } from '../lib/auth';
import { supabase } from '../lib/supabase';

export function RecoveryPage() {
  const [params] = useSearchParams();
  const requestMode = params.get('mode') === 'request';
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [hasRecoverySession,setHasRecoverySession]=useState(false);
  const [busy,setBusy]=useState(false);
  const [complete,setComplete]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    if(requestMode || !supabase) return;
    supabase.auth.getSession().then(({data})=>setHasRecoverySession(Boolean(data.session))).catch(()=>setHasRecoverySession(false));
    const {data}=supabase.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY' || session) setHasRecoverySession(true);
    });
    return ()=>data.subscription.unsubscribe();
  },[requestMode]);

  if(complete) return <Navigate to="/ops" replace/>;

  const send=async()=>{
    setBusy(true);setMessage('');
    try{
      await requestPasswordReset(email);
      setMessage('If that account exists, a password reset link has been sent.');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Unable to request password reset.');
    }finally{setBusy(false);}
  };

  const save=async()=>{
    if(password!==confirm){setMessage('Passwords do not match.');return;}
    setBusy(true);setMessage('');
    try{
      await updatePassword(password);
      setComplete(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Unable to update password.');
    }finally{setBusy(false);}
  };

  return <main className="auth-shell"><section className="auth-card">
    <span className="brand-mark large">B</span>
    <span className="eyebrow">BuhurtOS account recovery</span>
    {requestMode ? <>
      <h1>Reset your password</h1>
      <p>Enter the email address on your BuhurtOS account. The reset link returns here securely.</p>
      <label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
      {message&&<div className="auth-message">{message}</div>}
      <button className="primary big" disabled={busy||!email.trim()} onClick={send}>Send Reset Link</button>
      <Link className="button-link" to="/ops/login">Back to sign in</Link>
    </> : <>
      <h1>Choose a new password</h1>
      <p>{hasRecoverySession?'Use at least 10 characters.':'Open this page from the password reset link in your email.'}</p>
      <label>New password<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
      {message&&<div className="auth-message">{message}</div>}
      <button className="primary big" disabled={busy||!hasRecoverySession||password.length<10||!confirm} onClick={save}>Update Password</button>
      {!hasRecoverySession&&<Link className="button-link" to="/ops/recover?mode=request">Request another reset link</Link>}
    </>}
  </section></main>;
}
