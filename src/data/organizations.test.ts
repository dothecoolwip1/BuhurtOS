import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { cleanReason, enabledArgs, ORGANIZATION_COLUMNS, organizationLabel, organizationStatusLabel, REASON_MAX, toActiveOrganization, toAdminOrganization, toOrganization, toOrganizationStaff } from './organizations';

describe('organization mappers', () => {
  it('maps a public organization row and keeps the enabled flag', () => {
    const o = toOrganization({ id: 'o', slug: 'nacl-test', name: 'Northern Armored Combat League-test', short_name: 'NACL-test', kind: 'regional', country: 'CA', region: 'North',
      website: null, description: 'd', enabled: false, disabled_at: '2026-01-01T00:00:00Z', created_at: 'c' });
    expect(o).toMatchObject({ slug: 'nacl-test', shortName: 'NACL-test', enabled: false, disabledAt: '2026-01-01T00:00:00Z' });
    expect(organizationStatusLabel(o)).toBe('Inactive');
    expect(organizationStatusLabel({ enabled: true })).toBe('Active');
  });
  it('prefers the short name for labels', () => {
    expect(organizationLabel({ name: 'Long Name', shortName: 'LN' })).toBe('LN');
    expect(organizationLabel({ name: 'Long Name', shortName: null })).toBe('Long Name');
  });
  it('never asks for disabled_by or a star', () => {
    expect(ORGANIZATION_COLUMNS).not.toContain('disabled_by');
    expect(ORGANIZATION_COLUMNS).not.toContain('*');
    expect(ORGANIZATION_COLUMNS.split(',')).toContain('enabled');
  });
  it('maps active organizations', () => {
    expect(toActiveOrganization({ id: 'o', slug: 's', name: 'N', short_name: null, kind: 'club', country: null, region: null, website: null, description: null }).shortName).toBeNull();
  });
  it('turns bigint counts from the admin list into numbers', () => {
    const a = toAdminOrganization({ id: 'o', slug: 's', name: 'N', short_name: null, kind: 'club', country: null, region: null, enabled: true, disabled_at: null, disabled_by: null,
      teams_count: '10', fighters_count: 120, events_completed: '15', events_current: '0', events_upcoming: 1, admins_count: '2' });
    expect(a).toMatchObject({ teamsCount: 10, fightersCount: 120, eventsCompleted: 15, eventsCurrent: 0, eventsUpcoming: 1, adminsCount: 2, enabled: true });
  });
  it('maps staff', () => {
    expect(toOrganizationStaff({ user_id: 'u', email: 'a@b.c', role: 'admin' })).toEqual({ userId: 'u', email: 'a@b.c', role: 'admin' });
  });
});

describe('set_organization_enabled arguments', () => {
  it('names the three database parameters', () => {
    expect(enabledArgs('o', false, 'why')).toEqual({ p_org: 'o', p_enabled: false, p_reason: 'why' });
    expect(enabledArgs('o', true, null)).toEqual({ p_org: 'o', p_enabled: true, p_reason: null });
  });
  it('trims the reason, empties become null, long ones are refused', () => {
    expect(cleanReason('  ')).toEqual({ reason: null, error: null });
    expect(cleanReason(' hello ').reason).toBe('hello');
    expect(cleanReason('x'.repeat(REASON_MAX + 1)).error).toMatch(/500/);
    expect(cleanReason('x'.repeat(REASON_MAX)).error).toBeNull();
  });
});
