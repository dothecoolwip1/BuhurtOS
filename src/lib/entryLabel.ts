/** Shown where an entry exists but its name is hidden because the team is not approved yet. */
export const UNNAMED_ENTRY = 'Unnamed entry (team awaiting approval)';

/**
 * The text for one side of a match. An entry id with no name means the team is still awaiting approval, so say that.
 * No entry id means the side is simply not decided yet, and `whenEmpty` (for example 'To be decided') is used.
 */
export const sideLabel = (entryId: string | null | undefined, name: string | null | undefined, whenEmpty: string): string =>
  name ? name : entryId ? UNNAMED_ENTRY : whenEmpty;
