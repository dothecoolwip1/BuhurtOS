import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('offline app assets',()=>{
  it('reopens a precached module when the host varied the response by Origin',async()=>{
    const listeners=new Map<string,(event:unknown)=>void>();
    const asset=new Request('https://rehearsal.example.test/assets/app-123.js',{mode:'cors',headers:{Origin:'https://rehearsal.example.test'}});
    let response:Promise<Response>|undefined;
    runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{
      self:{registration:{scope:'https://rehearsal.example.test/'},location:{origin:'https://rehearsal.example.test'},addEventListener:(name:string,fn:(e:unknown)=>void)=>listeners.set(name,fn)},
      URL,Response,
      caches:{match:async(req:Request,options?:{ignoreVary?:boolean})=>req.url===asset.url&&options?.ignoreVary?new Response('cached module',{headers:{Vary:'Origin'}}):undefined},
      fetch:async()=>{throw Error('No network');}
    });
    listeners.get('fetch')!({request:asset,respondWith:(r:Promise<Response>)=>{response=r;}});
    expect(await (await response!).text()).toBe('cached module');
  });
});
