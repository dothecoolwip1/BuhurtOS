export async function shareCurrentPage(title: string, text?: string): Promise<'shared' | 'copied'> {
  const url = typeof window === 'undefined' ? '' : window.location.href;
  if (typeof navigator !== 'undefined' && navigator.share) {
    await navigator.share({ title, text, url });
    return 'shared';
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard && url) {
    await navigator.clipboard.writeText(url);
    return 'copied';
  }
  throw new Error('Sharing is not available in this browser.');
}
