import { expect, test } from 'vitest';
import { hasPermission } from '../src/lib/permissions';
import { defaultRulesetSettings, resolveRulesetSettings } from '../src/lib/rulesetAdmin';
import type { RulesetRecord, UserContext } from '../src/types';

test('ruleset inheritance keeps parent values and deep merges child overrides', () => {
  const parent: RulesetRecord = {
    id: 'parent',
    name: 'Base Rules',
    shortName: 'BASE',
    version: '1.0',
    status: 'published',
    settings: {
      ...structuredClone(defaultRulesetSettings),
      enabledFormats: ['longsword', '5v5'],
      scoringOverrides: { longsword: { roundsRequired: 5 } },
      compliance: { ...defaultRulesetSettings.compliance, requireWeighIn: false },
      discipline: { yellowCardsBeforeSuspension: 3, redCardSuspensionMatches: 2 },
      bracket: { antiFratricide: true }
    }
  };
  const child: RulesetRecord = {
    id: 'child',
    organizationId: 'org',
    parentRulesetId: parent.id,
    name: 'Local Rules',
    shortName: 'LOCAL',
    version: '1.1',
    status: 'published',
    settings: structuredClone(defaultRulesetSettings),
    overrides: {
      enabledFormats: ['longsword'],
      scoringOverrides: { longsword: { scoreCapPerRound: 12 } },
      compliance: { requireMedicalClearance: false },
      discipline: { yellowCardsBeforeSuspension: 4 },
      bracket: { antiFratricide: false }
    }
  };

  const resolved = resolveRulesetSettings([parent, child], child.id);
  expect(resolved.enabledFormats).toEqual(['longsword']);
  expect(resolved.scoringOverrides.longsword).toEqual({ roundsRequired: 5, scoreCapPerRound: 12 });
  expect(resolved.compliance.requireWeighIn).toBe(false);
  expect(resolved.compliance.requireMedicalClearance).toBe(false);
  expect(resolved.discipline.redCardSuspensionMatches).toBe(2);
  expect(resolved.discipline.yellowCardsBeforeSuspension).toBe(4);
  expect(resolved.bracket.antiFratricide).toBe(false);
});

test('ruleset inheritance rejects cycles', () => {
  const make = (id: string, parentRulesetId: string): RulesetRecord => ({
    id,
    parentRulesetId,
    name: id,
    shortName: id,
    version: '1',
    status: 'draft',
    settings: structuredClone(defaultRulesetSettings)
  });
  expect(() => resolveRulesetSettings([make('a', 'b'), make('b', 'a')], 'a')).toThrow(/cycle/i);
});

test('event permissions stay scoped to the assigned event and organization', () => {
  const marshal: UserContext = {
    userId: 'marshal',
    displayName: 'Marshal',
    platformRoles: [],
    organizationRoles: [],
    eventRoles: [{ eventId: 'event-a', role: 'field_marshal' }]
  };
  expect(hasPermission(marshal, 'match.score', 'event-a', 'org')).toBe(true);
  expect(hasPermission(marshal, 'match.score', 'event-b', 'org')).toBe(false);
  expect(hasPermission(marshal, 'bracket.manage', 'event-a', 'org')).toBe(false);

  const orgAdmin: UserContext = {
    userId: 'admin',
    displayName: 'Org Admin',
    platformRoles: [],
    organizationRoles: [{ organizationId: 'org', role: 'organization_admin' }],
    eventRoles: []
  };
  expect(hasPermission(orgAdmin, 'bracket.manage', 'event-b', 'org')).toBe(true);
  expect(hasPermission(orgAdmin, 'bracket.manage', 'event-b', 'other')).toBe(false);
});
