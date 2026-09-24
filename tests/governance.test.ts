import { describe, expect, it } from 'vitest';
import { competitionFormats, verifiedCompetitionFormats } from '../src/lib/competitionFormats';
import { evaluateDivisionEligibility } from '../src/lib/governance';
import type { CompetitionDivision } from '../src/types';

const division:CompetitionDivision={
  id:'division',organizationId:'org',name:'Adult Longsword',slug:'adult-longsword',
  version:1,competitionFormatId:'longsword',teamSize:1,ageMin:18,maxWeightKg:120,
  minExperienceYears:1,eligibilityLabel:'Adult experienced fighter',
  eligibilityRules:[
    {kind:'declaration',key:'armor_check',label:'Armor check passed'},
    {kind:'custom',key:'local_clearance',label:'Local organization clearance',value:'approved'}
  ],
  status:'published',metadata:{},revision:1
};

describe('Pack 5 competition format support',()=>{
  it('defaults only source-backed current BI categories to verified support',()=>{
    expect(verifiedCompetitionFormats.length).toBeGreaterThan(0);
    expect(verifiedCompetitionFormats.every(format=>format.supportLevel==='verified')).toBe(true);
    expect(verifiedCompetitionFormats.map(format=>format.id)).toEqual(
      expect.arrayContaining(['longsword','sword_buckler','sword_shield','polearm','3v3','5v5','12v12','outrance'])
    );
  });

  it('labels organization templates instead of presenting them as verified rules',()=>{
    expect(competitionFormats.find(format=>format.id==='21v21')?.supportLevel).toBe('custom_template');
    expect(competitionFormats.find(format=>format.id==='outrance')?.supportLevel).toBe('verified');
  });
});

describe('Pack 5 division eligibility',()=>{
  it('never silently passes a fighter when required facts are missing',()=>{
    const result=evaluateDivisionEligibility(division,{},'2026-09-26T12:00:00Z');
    expect(result.status).toBe('needs_review');
    expect(result.reasons.join(' ')).toMatch(/Age needs verification/i);
    expect(result.reasons.join(' ')).toMatch(/Armor check passed needs organizer verification/i);
  });

  it('explains hard eligibility failures',()=>{
    const result=evaluateDivisionEligibility(division,{
      ageYears:17,weightKg:90,experienceYears:2,teamSize:1,
      declarations:{armor_check:true},customValues:{local_clearance:'approved'}
    });
    expect(result.status).toBe('ineligible');
    expect(result.reasons.join(' ')).toMatch(/below the minimum of 18/i);
  });

  it('passes only when every configured fact and declaration is satisfied',()=>{
    const result=evaluateDivisionEligibility(division,{
      birthDate:'2000-10-01',weightKg:90,experienceYears:3,teamSize:1,
      declarations:{armor_check:true},customValues:{local_clearance:'approved'}
    },'2026-09-26T12:00:00Z');
    expect(result.status).toBe('eligible');
    expect(result.reasons).toEqual([]);
  });

  it('calculates age on the event date instead of calendar year alone',()=>{
    const result=evaluateDivisionEligibility(
      {...division,ageMin:18,maxWeightKg:undefined,minExperienceYears:undefined,teamSize:undefined,eligibilityRules:[]},
      {birthDate:'2008-10-01'},
      '2026-09-26T12:00:00Z'
    );
    expect(result.status).toBe('ineligible');
    expect(result.reasons.join(' ')).toMatch(/below the minimum of 18/i);
  });
});
