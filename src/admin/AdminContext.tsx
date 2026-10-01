import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { FIELD_QUEUES, REGISTRATIONS, type QueueItem, type Registration, type Role } from './data';

interface Checks { in: boolean; kit: boolean }
interface Ctx {
  role: Role;
  setRole: (r: Role) => void;
  regs: Registration[];
  decide: (id: string, status: 'accepted' | 'declined' | 'pending') => void;
  approveTeam: (id: string) => void;
  togglePaid: (id: string) => void;
  checks: Record<string, Checks>;
  toggleCheck: (key: string, which: keyof Checks) => void;
  queues: typeof FIELD_QUEUES;
  advance: (qi: number, id: string, to: QueueItem['state']) => void;
}

const C = createContext<Ctx | null>(null);
export const useAdmin = () => { const c = useContext(C); if (!c) throw new Error('AdminProvider missing'); return c; };

export function AdminProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('organizer');
  const [regs, setRegs] = useState(REGISTRATIONS);
  const [checks, setChecks] = useState<Record<string, Checks>>({ 'r1:0': { in: true, kit: true }, 'r1:1': { in: true, kit: false } });
  const [queues, setQueues] = useState(FIELD_QUEUES);
  const decide = useCallback((id: string, status: 'accepted' | 'declined' | 'pending') => setRegs(r => r.map(x => (x.id === id ? { ...x, status } : x))), []);
  const approveTeam = useCallback((id: string) => setRegs(r => r.map(x => (x.id === id ? { ...x, newTeam: false } : x))), []);
  const togglePaid = useCallback((id: string) => setRegs(r => r.map(x => (x.id === id ? { ...x, paid: !x.paid } : x))), []);
  const toggleCheck = useCallback((key: string, which: keyof Checks) => setChecks(c => { const cur: Checks = c[key] ?? { in: false, kit: false }; return { ...c, [key]: { ...cur, [which]: !cur[which] } }; }), []);
  const advance = useCallback((qi: number, id: string, to: QueueItem['state']) => setQueues(q => q.map((f, i) => (i !== qi ? f : { ...f, items: f.items.map(it => (it.id === id ? { ...it, state: to } : it)) }))), []);
  const value = useMemo(() => ({ role, setRole, regs, decide, approveTeam, togglePaid, checks, toggleCheck, queues, advance }), [role, regs, decide, approveTeam, togglePaid, checks, toggleCheck, queues, advance]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
