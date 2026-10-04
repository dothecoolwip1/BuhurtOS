export const DRAFT_NOTICE = 'Draft: only you and your event staff can see this';

/** gar***@gmail.com. Never returns the full local part; short names keep one letter. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const keep = local.length >= 6 ? 3 : local.length >= 3 ? 2 : 1;
  return `${local.slice(0, keep)}***${email.slice(at)}`;
}

export function notPublicMessage(email: string | null | undefined): string {
  const masked = maskEmail(email);
  return `This event is not public yet. If you are an organizer, make sure you are signed in with the account that organizes it${masked ? ` (you are signed in as ${masked})` : ''}.`;
}

/** Drafts are shown separately, and only to a signed-in viewer; the database already limits drafts to staff and the owner. */
export function splitDrafts<T extends { status: string }>(events: T[], signedIn: boolean): { drafts: T[]; published: T[] } {
  const drafts = signedIn ? events.filter(e => e.status === 'draft') : [];
  return { drafts, published: events.filter(e => e.status !== 'draft') };
}

