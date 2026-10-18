/**
 * Which realm this build is: the live site, or the beta realm where testers try things first.
 *
 * Set at build time with VITE_REALM=beta (Vercel environment variable on the beta project, or `VITE_REALM=beta npm run dev` locally). Anything
 * else, including unset, is live. The flag only decides what the screen shows (tester tools, experiments); it is never a security boundary.
 * Permissions stay in the database.
 */
export type Realm = 'live' | 'beta';

export function realmOf(value: unknown): Realm {
  return typeof value === 'string' && value.trim().toLowerCase() === 'beta' ? 'beta' : 'live';
}

export const realm = (): Realm => realmOf(import.meta.env.VITE_REALM);
export const isBeta = (): boolean => realm() === 'beta';
