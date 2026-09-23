import type { EventSnapshot } from './repository';

const DB_NAME='buhurtos-state';
const DB_VERSION=1;
const STORE='event_snapshots';

interface SnapshotRecord {
  key:string;
  scope:string;
  eventId:string;
  updatedAt:string;
  snapshot:EventSnapshot;
}

function supported(){return typeof indexedDB!=='undefined';}

function openDb():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      const store=db.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : db.createObjectStore(STORE,{keyPath:'key'});
      if(!store.indexNames.contains('scope'))store.createIndex('scope','scope',{unique:false});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

async function transact<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode);
    const request=work(tx.objectStore(STORE));
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    tx.oncomplete=()=>db.close();
    tx.onerror=()=>reject(tx.error);
  });
}

export async function saveEventSnapshotCache(scope:string,snapshot:EventSnapshot):Promise<void>{
  if(!supported())return;
  const record:SnapshotRecord={
    key:scope+':'+snapshot.event.id,
    scope,
    eventId:snapshot.event.id,
    updatedAt:new Date().toISOString(),
    snapshot:structuredClone(snapshot)
  };
  await transact('readwrite',store=>store.put(record));
}

export async function loadEventSnapshotCache(scope:string,eventId?:string):Promise<EventSnapshot|null>{
  if(!supported())return null;
  if(eventId){
    const record=await transact<SnapshotRecord|undefined>('readonly',store=>store.get(scope+':'+eventId));
    return record?.snapshot??null;
  }
  const rows=await transact<SnapshotRecord[]>('readonly',store=>store.index('scope').getAll(scope));
  rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  return rows[0]?.snapshot??null;
}

export async function clearPrivateSnapshotCache(scope:string):Promise<void>{
  if(!supported()||scope==='public')return;
  const rows=await transact<SnapshotRecord[]>('readonly',store=>store.index('scope').getAll(scope));
  for(const row of rows)await transact('readwrite',store=>store.delete(row.key));
}
