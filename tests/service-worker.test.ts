import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const cache = { put: vi.fn(), addAll: vi.fn() };
  const caches = {
    open: vi.fn(async () => cache), match: vi.fn(async () => undefined),
    keys: vi.fn(async () => ['buhurtos-shell-v3', 'other-app-cache']), delete: vi.fn()
  };
  const fetch = vi.fn(async () => new Response('ok'));
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { registration: { scope: 'https://example.test/BuhurtOS/' },
      clients: { claim: vi.fn(), matchAll: vi.fn(async () => []) },
      addEventListener: (name: string, handler: any) => { handlers[name] = handler; } },
    caches, fetch, URL, Response
  });
  return { handlers, cache, caches, fetch };
}

describe('service worker isolation', () => {
  it.each([
    ['https://project.supabase.co/rest/v1/fighters', {}],
    ['https://example.test/another-app/', {}],
    ['https://example.test/BuhurtOS/private', { headers: { Authorization: 'Bearer test' } }],
    ['https://example.test/BuhurtOS/api/private', {}]
  ])('leaves private or out-of-scope requests to the network: %s', (url, init) => {
    const { handlers } = worker();
    const respondWith = vi.fn();
    handlers.fetch({ request: new Request(url, init), respondWith, waitUntil: vi.fn() });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it('does not delete caches owned by other apps', async () => {
    const { handlers, caches } = worker();
    let work: Promise<unknown> | undefined;
    handlers.activate({ waitUntil: (promise: Promise<unknown>) => { work = promise; } });
    await work;
    expect(caches.delete).not.toHaveBeenCalledWith('other-app-cache');
    expect(caches.delete).toHaveBeenCalledWith('buhurtos-shell-v3');
  });

  it('does not return HTML for a missing script offline', async () => {
    const { handlers, caches, fetch } = worker();
    fetch.mockRejectedValue(new Error('offline'));
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: new Request('https://example.test/BuhurtOS/assets/missing.js'),
      respondWith: (promise: Promise<Response>) => { response = promise; }, waitUntil: vi.fn() });
    expect((await response)?.status).toBe(503);
    expect(caches.match).not.toHaveBeenCalledWith('/BuhurtOS/');
  });
});
