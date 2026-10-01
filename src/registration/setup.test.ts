import { describe, expect, it } from 'vitest';
import { publishChecklist, toPatch, validateSetup, type SetupForm } from './setup';
import { localToIso } from '../lib/dates';

const form = (o: Partial<SetupForm> = {}): SetupForm => ({
  name: 'Red Deer Rumble 2026', description: '', venue: 'Horse In Hand Ranch', address: '', city: 'Blackfalds', region: 'AB', startsOn: '2026-11-14', endsOn: '2026-11-15',
  opensLocal: '', closesLocal: '2026-11-08T23:59', feeDollars: '40', feeProvince: 'AB', feeNote: '',
  eventType: 'tournament', registrationMode: 'buhuros', externalUrl: '', timeNote: '', volunteerInfo: '', ...o
});

describe('setup validation', () => {
  it('accepts the Rumble as set up', () => expect(validateSetup(form())).toEqual({}));
  it('catches a short name, backwards dates and close before open', () => {
    expect(validateSetup(form({ name: 'ab' })).name).toBeTruthy();
    expect(validateSetup(form({ endsOn: '2026-11-13' })).endsOn).toBeTruthy();
    expect(validateSetup(form({ opensLocal: '2026-11-09T00:00', closesLocal: '2026-11-08T23:59' })).closesLocal).toBeTruthy();
  });
  it('needs to know who pays when there is a fee', () => {
    expect(validateSetup(form({ feeProvince: '' })).feeProvince).toBeTruthy();
    expect(validateSetup(form({ feeDollars: '0', feeProvince: '' }))).toEqual({});
    expect(validateSetup(form({ feeDollars: '-5' })).feeDollars).toBeTruthy();
  });
});

describe('patch', () => {
  it('stores dollars as cents and times as exact instants', () => {
    const p = toPatch(form());
    expect(p.fee_cents).toBe(4000);
    expect(p.fee_province).toBe('AB');
    expect(p.registration_closes_at).toBe(localToIso('2026-11-08T23:59'));
    expect(p.registration_opens_at).toBeNull();
  });
  it('"Everyone" means no province restriction; a zero fee clears it', () => {
    expect(toPatch(form({ feeProvince: 'ALL' })).fee_province).toBeNull();
    expect(toPatch(form({ feeDollars: '0', feeProvince: 'AB' })).fee_province).toBeNull();
  });
  it('rounds cents correctly', () => expect(toPatch(form({ feeDollars: '12.345' })).fee_cents).toBe(1235));
});

describe('events that are not tournaments', () => {
  it('an external event needs a real link', () => {
    expect(validateSetup(form({ registrationMode: 'external', externalUrl: '' })).externalUrl).toBeTruthy();
    expect(validateSetup(form({ registrationMode: 'external', externalUrl: 'javascript:alert(1)' })).externalUrl).toBeTruthy();
    expect(validateSetup(form({ registrationMode: 'external', externalUrl: 'https://tickets.example.test/feast' })).externalUrl).toBeUndefined();
  });
  it('a price to show needs no province when people sign up elsewhere', () => {
    expect(validateSetup(form({ registrationMode: 'external', externalUrl: 'https://t.example.test/x', feeDollars: '35', feeProvince: '' })).feeProvince).toBeUndefined();
    expect(toPatch(form({ registrationMode: 'external', externalUrl: 'https://t.example.test/x', feeDollars: '35', feeProvince: 'AB' })).fee_province).toBeNull();
  });
  it('the link is only stored for external events', () => {
    expect(toPatch(form({ registrationMode: 'external', externalUrl: ' https://t.example.test/x ' })).external_url).toBe('https://t.example.test/x');
    expect(toPatch(form({ registrationMode: 'none', externalUrl: 'https://t.example.test/x' })).external_url).toBeNull();
    expect(toPatch(form({ eventType: 'gathering', timeNote: ' Doors 6 pm ' })).time_note).toBe('Doors 6 pm');
  });
});

const base = { competitions: 0, waivers: 0, hasClose: false, hasVenue: true, hasLink: false };
describe('publish checklist', () => {
  it('a tournament on BuhurtOS needs competitions and a waiver; the rest only warns', () => {
    const c = publishChecklist({ ...base, eventType: 'tournament', registrationMode: 'buhuros' });
    expect(c.filter(x => !x.ok && x.blocking).length).toBe(2);
    expect(c.filter(x => !x.ok && !x.blocking).length).toBe(1);
  });
  it('is clear when everything is in place', () => {
    expect(publishChecklist({ ...base, eventType: 'tournament', registrationMode: 'buhuros', competitions: 17, waivers: 1, hasClose: true }).every(x => x.ok)).toBe(true);
  });
  it('a feast or dance with tickets elsewhere needs only its link', () => {
    const c = publishChecklist({ ...base, eventType: 'gathering', registrationMode: 'external' });
    expect(c.filter(x => x.blocking).map(x => x.ok)).toEqual([false]);
    expect(publishChecklist({ ...base, eventType: 'gathering', registrationMode: 'external', hasLink: true }).every(x => x.ok)).toBe(true);
  });
  it('an event with no sign-up needs nothing blocking', () => {
    expect(publishChecklist({ ...base, eventType: 'demonstration', registrationMode: 'none' }).some(x => x.blocking)).toBe(false);
  });
});
