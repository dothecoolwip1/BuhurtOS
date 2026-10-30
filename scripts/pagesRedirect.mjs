// The GitHub Pages copy (dothecoolwip1.github.io/BuhurtOS) forwards to https://buhurt-os.app, keeping the page, query and hash.
// Owner decision 2026-10-30. Run on the Pages build only (pages.yml); the Vercel build never contains this.
// A device that still has score actions waiting in its outbox is NOT forwarded: the browser keeps that queue per address, so the
// old copy loads as before and sends them first. The next visit after the queue is empty forwards.
//   node scripts/pagesRedirect.mjs dist/index.html
import { readFileSync, writeFileSync } from 'node:fs';

export const NEW_ORIGIN = 'https://buhurt-os.app';

/** The address on the new domain for a page of the old copy (served under /BuhurtOS/). */
export function redirectTarget(pathname, search = '', hash = '') {
  const path = pathname.replace(/^\/BuhurtOS(?=\/|$)/i, '') || '/';
  return NEW_ORIGIN + path + search + hash;
}

// Runs before the app. Stays ES5 so it can never fail to parse on an old phone.
export const SNIPPET = `<script>/* moved to ${NEW_ORIGIN} */(function(){
var T=${JSON.stringify(NEW_ORIGIN)},p=location.pathname.replace(/^\\/BuhurtOS(?=\\/|$)/i,'')||'/',d=T+p+location.search+location.hash,done=false;
function go(){if(!done){done=true;location.replace(d);}}
try{
if(!window.indexedDB){go();return;}
var r=indexedDB.open('buhurtos-scoring');
r.onupgradeneeded=function(){try{r.transaction.abort();}catch(e){}};
r.onerror=go;r.onblocked=go;
r.onsuccess=function(){var db=r.result;
if(!db.objectStoreNames.contains('outbox')){db.close();go();return;}
var q=db.transaction('outbox').objectStore('outbox').getAll();
q.onerror=function(){db.close();go();};
q.onsuccess=function(){var n=0,a=q.result||[];for(var i=0;i<a.length;i++){if(a[i]&&a[i].status==='pending')n++;}db.close();if(n===0)go();};
};
}catch(e){go();}
})();</script>`;

export function injectRedirect(html) {
  if (html.includes('/* moved to ')) return html;
  if (!html.includes('<head>')) throw new Error('no <head> in index.html');
  return html.replace('<head>', `<head>\n  ${SNIPPET}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2] ?? 'dist/index.html';
  writeFileSync(file, injectRedirect(readFileSync(file, 'utf8')));
  console.log(`${file}: forwards to ${NEW_ORIGIN}`);
}
