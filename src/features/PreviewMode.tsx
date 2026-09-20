import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type PreviewRole = 'bi_admin' | 'hacsa_admin' | 'captain' | 'fighter' | 'spectator';

const labels: Record<PreviewRole, string> = {
  bi_admin: 'BI Admin',
  hacsa_admin: 'HACSA Admin',
  captain: 'Team Captain',
  fighter: 'Fighter',
  spectator: 'Spectator'
};

interface PreviewModeValue {
  role: PreviewRole;
  setRole: (role: PreviewRole) => void;
  roleLabel: string;
}

const PreviewModeContext = createContext<PreviewModeValue | null>(null);

export function PreviewModeProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<PreviewRole>('hacsa_admin');
  const value = useMemo(() => ({ role, setRole, roleLabel: labels[role] }), [role]);
  return <PreviewModeContext.Provider value={value}>{children}</PreviewModeContext.Provider>;
}

export function usePreviewMode(): PreviewModeValue {
  const value = useContext(PreviewModeContext);
  if (!value) throw new Error('usePreviewMode must be used inside PreviewModeProvider.');
  return value;
}

export const previewRoleLabels = labels;
