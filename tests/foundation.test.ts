import { describe, expect, test } from 'vitest';
import { hasPermission } from '../src/lib/permissions';
import { defaultRulesetSettings, mergeRulesetSettings, resolveRulesetSettings } from '../src/lib/rulesetAdmin';
import { affiliationIsActiveAt, affiliationsAt, normalizeTemporaryFighterInput } from '../src/lib/identity';
import { assertDateRange, assertSafeMerge, normalizeCountryCode, normalizeEmail, validateEmail, validatePassword } from '../src/lib/validation';
import { retryDelayMs } from '../src/lib/offlineQueue';
import type { FighterAffiliation, RulesetRecord, UserContext } from '../src/types';

const baseUser:UserContext={
  userId:'user-1',
  displayName:'Test User',
  platformRoles:[],
  organizationRoles:[],
  eventRoles:[],
  permissionGrants:[]
};

describe('MEGA PACK 1 foundation',()=>{
  test('scoped permission grants do not bleed across organizations or events',()=>{
    const user:UserContext={...baseUser,permissionGrants:[
      {permission:'event.manage',organizationId:'org-a',eventId:'event-a'},
      {permission:'medical.manage',organizationId:'org-a',eventId:'event-a'}
    ]};
    expect(hasPermission(user,'event.manage','event-a','org-a')).toBe(true);
    expect(hasPermission(user,'medical.manage','event-a','org-a')).toBe(true);
    expect(hasPermission(user,'event.manage','event-b','org-a')).toBe(false);
    expect(hasPermission(user,'event.manage','event-a','org-b')).toBe(false);
    expect(hasPermission(user,'armor.inspect','event-a','org-a')).toBe(false);
  });

  test('specialist event roles receive only intended capabilities',()=>{
    const scorekeeper:UserContext={...baseUser,eventRoles:[{eventId:'event-a',role:'scorekeeper'}]};
    const medic:UserContext={...baseUser,eventRoles:[{eventId:'event-a',role:'medical_staff'}]};
    expect(hasPermission(scorekeeper,'match.score','event-a','org-a')).toBe(true);
    expect(hasPermission(scorekeeper,'match.manage','event-a','org-a')).toBe(false);
    expect(hasPermission(medic,'medical.manage','event-a','org-a')).toBe(true);
    expect(hasPermission(medic,'armor.inspect','event-a','org-a')).toBe(false);
    expect(hasPermission(medic,'roster.manage','event-a','org-a')).toBe(false);
  });

  test('organization administrators inherit organization foundation capabilities',()=>{
    const user:UserContext={...baseUser,organizationRoles:[{organizationId:'org-a',role:'organization_admin'}]};
    expect(hasPermission(user,'ruleset.manage',undefined,'org-a')).toBe(true);
    expect(hasPermission(user,'duplicate.merge',undefined,'org-a')).toBe(true);
    expect(hasPermission(user,'organization.manage',undefined,'org-b')).toBe(false);
  });

  test('ruleset inheritance deep merges nested overrides without rewriting the parent',()=>{
    const patch={
      timing:{rounds:5,roundDurationSeconds:90},
      compliance:{requireWeighIn:false},
      bracket:{antiFratricide:false}
    };
    const merged=mergeRulesetSettings(defaultRulesetSettings,patch);
    expect(merged.timing.rounds).toBe(5);
    expect(merged.timing.roundDurationSeconds).toBe(90);
    expect(merged.timing.overtimeEnabled).toBe(defaultRulesetSettings.timing.overtimeEnabled);
    expect(merged.compliance.requireWeighIn).toBe(false);
    expect(merged.compliance.requireArmorClearance).toBe(true);
    expect(merged.bracket.antiFratricide).toBe(false);
    expect(defaultRulesetSettings.timing.rounds).toBe(3);
    expect(defaultRulesetSettings.compliance.requireWeighIn).toBe(true);
  });

  test('ruleset resolver applies ancestry in order and rejects cycles',()=>{
    const rulesets:RulesetRecord[]=[
      {id:'base',name:'Base',shortName:'B',version:'1',status:'published',settings:{timing:{rounds:3},compliance:{requireWeighIn:true}}},
      {id:'child',parentRulesetId:'base',name:'Child',shortName:'C',version:'1',status:'draft',settings:{timing:{rounds:5},compliance:{requireWeighIn:false}}}
    ];
    const settings=resolveRulesetSettings(rulesets,'child');
    expect(settings.timing.rounds).toBe(5);
    expect(settings.compliance.requireWeighIn).toBe(false);
    const cycle:RulesetRecord[]=[
      {...rulesets[0],parentRulesetId:'child'},
      rulesets[1]
    ];
    expect(()=>resolveRulesetSettings(cycle,'child')).toThrow(/cycle/i);
  });

  test('dated fighter affiliations preserve historical representation',()=>{
    const history:FighterAffiliation[]=[
      {id:'a',fighterId:'f',organizationId:'o',teamId:'old',affiliationType:'permanent_team',startsOn:'2024-01-01',endsOn:'2025-06-30',isPrimary:true,metadata:{}},
      {id:'b',fighterId:'f',organizationId:'o',teamId:'new',affiliationType:'permanent_team',startsOn:'2025-07-01',isPrimary:true,metadata:{}},
      {id:'c',fighterId:'f',organizationId:'o',teamId:'merc',eventId:'event-x',affiliationType:'mercenary',startsOn:'2025-08-01',endsOn:'2025-08-02',isPrimary:false,metadata:{}}
    ];
    expect(affiliationIsActiveAt(history[0],new Date('2025-06-15T12:00:00Z'))).toBe(true);
    expect(affiliationsAt(history,new Date('2025-06-15T12:00:00Z')).map(item=>item.teamId)).toEqual(['old']);
    expect(affiliationsAt(history,new Date('2025-08-01T12:00:00Z'),{eventId:'event-x'}).map(item=>item.teamId)).toEqual(['new','merc']);
    expect(affiliationsAt(history,new Date('2025-08-01T12:00:00Z'),{eventId:'different'}).map(item=>item.teamId)).toEqual(['new']);
  });

  test('temporary fighter input is normalized but permanent affiliation is not invented',()=>{
    expect(normalizeTemporaryFighterInput({displayName:'  Jane   Doe ',countryCode:'ca',teamId:'team',divisionId:'division'})).toEqual({
      displayName:'Jane Doe',countryCode:'CA',teamId:'team',divisionId:'division'
    });
    expect(()=>normalizeTemporaryFighterInput({displayName:' ',countryCode:'CA'})).toThrow();
    expect(()=>normalizeTemporaryFighterInput({displayName:'Jane',countryCode:'CAN'})).toThrow();
  });

  test('critical validation rejects destructive and malformed input',()=>{
    expect(normalizeEmail(' Test@Example.COM ')).toBe('test@example.com');
    expect(validateEmail('bad')).not.toBeNull();
    expect(validateEmail('good@example.com')).toBeNull();
    expect(validatePassword('short')).not.toBeNull();
    expect(validatePassword('long-enough')).toBeNull();
    expect(normalizeCountryCode(' ca ')).toBe('CA');
    expect(()=>normalizeCountryCode('CAN')).toThrow();
    expect(()=>assertDateRange('2026-09-23','2026-09-22')).toThrow();
    expect(()=>assertSafeMerge('bad','also-bad','duplicate')).toThrow();
    expect(()=>assertSafeMerge('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','duplicate')).toThrow();
    expect(()=>assertSafeMerge('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','duplicate')).not.toThrow();
  });

  test('offline retry backoff is bounded',()=>{
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(2)).toBe(4000);
    expect(retryDelayMs(20)).toBe(300000);
  });
});
