import { useEffect, useState } from 'react';
import { useAppState } from '../features/AppState';
import { discardMutation, listMutations, retryMutation } from '../lib/offlineQueue';
import type { OfflineMutation } from '../types';

export function SyncPage() {
  const { online, syncNow, refreshQueue } = useAppState();
  const [items, setItems] = useState<OfflineMutation[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => setItems(await listMutations());
  useEffect(() => { load(); }, []);
  const retry = async (id: string) => { await retryMutation(id); await refreshQueue(); await load(); };
  const discard = async (id: string) => { await discardMutation(id); await refreshQueue(); await load(); };
  const sync = async () => { setBusy(true); try { await syncNow(); await load(); } finally { setBusy(false); } };
  return <>
    <section className="section-head"><div><span className="eyebrow">Offline recovery</span><h1>Sync Queue</h1><p>Queued field actions stay on this device until the server accepts them. Conflicts require an explicit decision instead of silently overwriting another marshal.</p></div><div className="header-actions"><button disabled={!online || busy} onClick={sync}>{busy ? 'Syncing…' : 'Sync Now'}</button></div></section>
    {!online && <div className="state-card">This device is offline. You can inspect or discard queued work, and BuhurtOS will retry automatically when the connection returns.</div>}
    {items.length === 0 ? <div className="state-card">No queued, failed, or conflicted actions.</div> : <div className="sync-list">{items.map(item => <article className="sync-item" key={item.id}>
      <div className="sync-item-head"><div><strong>{item.entity.replaceAll('_',' ')}</strong><div><code>{item.entityId}</code></div></div><span className={`sync-state ${item.state}`}>{item.state}</span></div>
      <small>{new Date(item.createdAt).toLocaleString()} · {item.attempts} attempt{item.attempts === 1 ? '' : 's'}</small>
      {item.lastError && <div className="sync-error">{item.lastError}</div>}
      <div className="sync-actions">{(item.state === 'conflict' || item.state === 'failed') && <button onClick={() => retry(item.id)}>Retry Local Action</button>}<button onClick={() => discard(item.id)}>Discard Local Action</button></div>
    </article>)}</div>}
  </>;
}
