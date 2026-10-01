export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

interface ShareEnv {
  share?: (data: { title: string; text?: string; url: string }) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

/**
 * Share a link with the Web Share API where the browser has it (phones), otherwise copy it to the clipboard.
 * Closing the share sheet is not an error ('cancelled'). The environment is injectable so this can be tested without a browser.
 */
export async function shareLink(data: { title: string; text?: string; url: string }, env?: ShareEnv): Promise<ShareOutcome> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const share = env ? env.share : nav && typeof nav.share === 'function' ? (d: { title: string; text?: string; url: string }) => nav.share(d) : undefined;
  const writeText = env ? env.writeText : nav?.clipboard && typeof nav.clipboard.writeText === 'function' ? (t: string) => nav.clipboard.writeText(t) : undefined;
  if (share) {
    try { await share(data); return 'shared'; } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
      // fall through to copying: sharing can fail for reasons the person cannot fix (blocked, unsupported data)
    }
  }
  if (writeText) {
    try { await writeText(data.url); return 'copied'; } catch { return 'failed'; }
  }
  return 'failed';
}
