/**
 * The address this page load started on, read before Supabase exchanges and removes a one-time code from it (Pack 18). The reset-password and
 * sign-in pages use it to tell "the link worked" from "the link expired, was used, or was opened in another browser". Imported first in main.tsx.
 */
export const initialHref: string = typeof window !== 'undefined' ? window.location.href : '';
