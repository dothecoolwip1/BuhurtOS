import { useEffect, useState } from 'react';

type Theme='dark'|'light';

function preferredTheme():Theme{
  if(typeof window==='undefined')return 'dark';
  const stored=window.localStorage.getItem('buhurtos-theme');
  if(stored==='dark'||stored==='light')return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
}

export function ThemeToggle(){
  const [theme,setTheme]=useState<Theme>(()=>preferredTheme());
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    localStorage.setItem('buhurtos-theme',theme);
  },[theme]);
  return <button className="theme-toggle" type="button" onClick={()=>setTheme(current=>current==='dark'?'light':'dark')} aria-label={`Switch to ${theme==='dark'?'light':'dark'} theme`} title={`Switch to ${theme==='dark'?'light':'dark'} theme`}>
    <span aria-hidden="true">{theme==='dark'?'☀':'☾'}</span>
  </button>;
}
