/** Camera Off, in words (pure, so the wording a marshal reads in an emergency is tested). The state itself lives in the database; this only describes it. */
export type CameraOffReason = 'medical' | 'privacy' | 'camera_problem' | 'venue' | 'other';
export interface CameraState {
  active: boolean; reason: CameraOffReason | null;
  activatedAt: string | null; activatedByLabel: string | null; activatedByRole: string | null;
  releasedAt: string | null; releasedByLabel: string | null; releasedByRole: string | null;
  rev: number; canActivate: boolean; canRelease: boolean;
}
export const REASONS: { id: CameraOffReason; label: string; hint: string }[] = [
  { id: 'medical', label: 'Medical / injury', hint: 'Someone is hurt' },
  { id: 'privacy', label: 'Private moment', hint: 'Something that must not be on air' },
  { id: 'camera_problem', label: 'Camera problem', hint: 'Bad or wrong picture' },
  { id: 'venue', label: 'Venue problem', hint: 'Hall, crowd or safety' },
  { id: 'other', label: 'Other', hint: 'Organizer discretion' }
];
export const reasonLabel = (r: CameraOffReason | null): string => REASONS.find(x => x.id === r)?.label ?? 'Safety hold';
const ROLE_WORDS: Record<string, string> = { marshal: 'Marshal', head_marshal: 'Head Marshal', scorekeeper: 'Secretary / Scorekeeper', announcer: 'Announcer', temporary_organizer: 'Event Admin',
  organizer: 'Organizer', platform_owner: 'Platform owner', counter: 'Counter', staff: 'Staff' };
export const roleWords = (r: string | null): string => (r ? ROLE_WORDS[r] ?? r : 'Staff');
/** 7:42 PM in the viewer's own clock. */
export const clockTime = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
/** The banner everyone who can see the state reads while the cameras are off. */
export function bannerLines(s: Pick<CameraState, 'activatedByLabel' | 'activatedByRole' | 'activatedAt' | 'reason' | 'canRelease'>): string[] {
  const by = s.activatedByLabel ? `${s.activatedByLabel}${s.activatedByRole ? ` (${roleWords(s.activatedByRole)})` : ''}` : 'Unknown';
  return ['CAMERAS OFF', `Reason: ${reasonLabel(s.reason)}`, `Activated by: ${by}`, `Time: ${clockTime(s.activatedAt)}`,
    s.canRelease ? 'Turn them back on only when it is safe.' : 'Waiting for authorized release (head marshal or event admin).'];
}
