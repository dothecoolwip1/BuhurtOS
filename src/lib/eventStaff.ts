/** Display routing only. Database functions enforce the actual role and fight boundary. */
export function isSecretaryOnly(roles: readonly string[], organizer = false): boolean {
  return !organizer && roles.includes('scorekeeper') && !roles.some(r => ['organizer', 'owner', 'head_marshal', 'marshal', 'operator'].includes(r));
}
