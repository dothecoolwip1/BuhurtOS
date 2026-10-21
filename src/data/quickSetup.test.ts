import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake database: per-table rows for plain reads, one row for maybeSingle reads, and the rpc results. Filters are not applied: each test
// gives exactly the rows row level security would return to the caller.
const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  single: {} as Record<string, unknown>,
  active: [] as unknown[]
}));
vi.mock('../lib/supabase', () => {
  const query = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: db.single[table] ?? null, error: null });
    q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve({ data: db.rows[table] ?? [], error: null }).then(ok, bad);
    return q;
  };
  return { supabase: { from: query, rpc: (fn: string) => Promise.resolve({ data: fn === 'list_active_organizations' ? db.active : null, error: null }) } };
});
const create = vi.hoisted(() => ({ createEvent: vi.fn(async () => 'ev1'), updateEvent: vi.fn(async () => undefined), createCompetition: vi.fn(async () => 'c1') }));
vi.mock('./setup', () => ({ createEvent: create.createEvent, updateEvent: create.updateEvent }));
vi.mock('./competitions', () => ({ createCompetition: create.createCompetition }));
const links = vi.hoisted(() => ({ setEventOrganization: vi.fn(async (_e: string, _o: string | null) => undefined), setEventSeason: vi.fn(async (_e: string, _s: string | null) => undefined) }));
vi.mock('./organizations', async orig => ({ ...(await orig<typeof import('./organizations')>()), setEventOrganization: links.setEventOrganization, setEventSeason: links.setEventSeason }));

import { checkOrganizationLink, createQuickEvent, isOrgLinkNotAllowed, type QuickEventInput } from './quickSetup';

const org = (id: string, name: string) => ({ id, slug: id, name, short_name: null, kind: 'club', country: 'CA', region: null, website: null, description: null });
const input = (over: Partial<QuickEventInput> = {}): QuickEventInput => ({
  userId: 'u-organizer', slug: 'northshore-melee-test', name: 'Northshore Melee (test)', startsOn: '2026-11-07', endsOn: '2026-11-07',
  venue: null, address: null, city: null, region: null, country: null, latitude: null, longitude: null, fieldCount: 1, organizationId: null, seasonId: null, competitions: [], ...over
});

beforeEach(() => {
  db.rows = { platform_roles: [{ role: 'organizer' }], organization_staff: [{ organization_id: 'o-tidewater' }] };
  db.single = {};
  db.active = [org('o-tidewater', 'Tidewater Steel League (test)'), org('o-ridgeback', 'Ridgeback Armoured Club (test)')];
  vi.clearAllMocks();
});

describe('createQuickEvent: the link is checked before anything is created', () => {
  it('refuses an organization the caller is not an admin of and makes no create call', async () => {
    const e = await createQuickEvent(input({ organizationId: 'o-ridgeback' })).catch(x => x);
    expect(isOrgLinkNotAllowed(e)).toBe(true);
    expect(create.createEvent).not.toHaveBeenCalled();
    expect(create.updateEvent).not.toHaveBeenCalled();
    expect(create.createCompetition).not.toHaveBeenCalled();
    expect(links.setEventOrganization).not.toHaveBeenCalled();
  });
  it('refuses a season whose organization (read from the server) the caller cannot link, whatever organizationId says', async () => {
    db.single = { seasons: { organization_id: 'o-ridgeback' } };
    const e = await createQuickEvent(input({ seasonId: 's1', organizationId: null })).catch(x => x);
    expect(isOrgLinkNotAllowed(e)).toBe(true);
    expect(create.createEvent).not.toHaveBeenCalled();
    const e2 = await createQuickEvent(input({ seasonId: 's1', organizationId: 'o-tidewater' })).catch(x => x);
    expect(isOrgLinkNotAllowed(e2)).toBe(true);
    expect(create.createEvent).not.toHaveBeenCalled();
  });
  it('refuses a season that does not exist', async () => {
    const e = await createQuickEvent(input({ seasonId: 'gone' })).catch(x => x);
    expect(isOrgLinkNotAllowed(e)).toBe(true);
    expect(create.createEvent).not.toHaveBeenCalled();
  });
  it('creates and links when the caller is an admin of the organization', async () => {
    const r = await createQuickEvent(input({ organizationId: 'o-tidewater' }));
    expect(r.id).toBe('ev1');
    expect(create.createEvent).toHaveBeenCalledTimes(1);
    expect(links.setEventOrganization).toHaveBeenCalledWith('ev1', 'o-tidewater');
  });
  it('creates with a season of the admin\'s own organization, and with a season that has no organization', async () => {
    db.single = { seasons: { organization_id: 'o-tidewater' } };
    await createQuickEvent(input({ seasonId: 's1' }));
    db.single = { seasons: { organization_id: null } };
    await createQuickEvent(input({ seasonId: 's2' }));
    expect(create.createEvent).toHaveBeenCalledTimes(2);
    expect(links.setEventSeason).toHaveBeenCalledTimes(2);
  });
  it('the platform owner may link any active organization, but not an inactive one', async () => {
    db.rows = { platform_roles: [{ role: 'owner' }], organization_staff: [] };
    await expect(checkOrganizationLink('u-owner', 'o-ridgeback', null)).resolves.toBeUndefined();
    await expect(checkOrganizationLink('u-owner', 'o-switched-off', null)).rejects.toSatisfy(isOrgLinkNotAllowed);
  });
  it('no organization and no season: nothing to check', async () => {
    db.rows = { platform_roles: [{ role: 'organizer' }], organization_staff: [] };
    await createQuickEvent(input());
    expect(create.createEvent).toHaveBeenCalledTimes(1);
  });
});
