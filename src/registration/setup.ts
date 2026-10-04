import type { EventType, RegistrationMode } from '../data/eventTypes';
import { localToIso } from '../lib/dates';

export interface SetupForm {
  name: string; description: string; venue: string; address: string; city: string; region: string;
  startsOn: string; endsOn: string; opensLocal: string; closesLocal: string;
  feeDollars: string; feeProvince: string; feeNote: string;
  eventType: EventType; registrationMode: RegistrationMode; externalUrl: string; timeNote: string; volunteerInfo: string;
}

/** Messages in plain words, keyed by field. */
export function validateSetup(f: SetupForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 3) e.name = 'Give the event a name of at least 3 letters.';
  if (!f.startsOn) e.startsOn = 'Choose the first day.';
  if (!f.endsOn) e.endsOn = 'Choose the last day.';
  if (f.startsOn && f.endsOn && f.endsOn < f.startsOn) e.endsOn = 'The last day cannot be before the first day.';
  const opens = f.opensLocal ? localToIso(f.opensLocal) : null;
  const closes = f.closesLocal ? localToIso(f.closesLocal) : null;
  if (f.opensLocal && !opens) e.opensLocal = 'Enter a valid date and time.';
  if (f.closesLocal && !closes) e.closesLocal = 'Enter a valid date and time.';
  if (opens && closes && closes <= opens) e.closesLocal = 'Registration must close after it opens.';
  const fee = Number(f.feeDollars || '0');
  if (!Number.isFinite(fee) || fee < 0 || fee > 10000) e.feeDollars = 'Enter an amount in dollars, like 40 or 0.';
  if (fee > 0 && f.registrationMode === 'buhuros' && !f.feeProvince) e.feeProvince = 'Say who pays: choose a province, or "Everyone".';
  if (f.registrationMode === 'external' && !/^https?:\/\/\S+$/i.test(f.externalUrl.trim())) e.externalUrl = 'Paste the full link, starting with https://';
  if (f.timeNote.length > 200) e.timeNote = 'Keep this under 200 characters.';
  if (f.volunteerInfo.length > 2000) e.volunteerInfo = 'Keep this under 2000 characters.';
  if (f.description.length > 4000) e.description = 'Keep the description under 4000 characters.';
  return e;
}

/** The exact column values to save. Only call after validateSetup returns no errors. */
export function toPatch(f: SetupForm) {
  const cents = Math.round(Number(f.feeDollars || '0') * 100);
  return {
    name: f.name.trim(), description: f.description.trim(), venue: f.venue.trim() || null, address: f.address.trim() || null,
    city: f.city.trim() || null, region: f.region.trim() || null, starts_on: f.startsOn, ends_on: f.endsOn,
    registration_opens_at: f.opensLocal ? localToIso(f.opensLocal) : null, registration_closes_at: f.closesLocal ? localToIso(f.closesLocal) : null,
    fee_cents: cents, fee_province: cents > 0 && f.registrationMode === 'buhuros' && f.feeProvince && f.feeProvince !== 'ALL' ? f.feeProvince : null, fee_note: f.feeNote.trim() || null,
    event_type: f.eventType, registration_mode: f.registrationMode,
    external_url: f.registrationMode === 'external' ? f.externalUrl.trim() : null, time_note: f.timeNote.trim() || null, volunteer_info: f.volunteerInfo.trim() || null
  };
}

export interface PublishCheck { key: 'competitions' | 'waiver' | 'close' | 'link' | 'venue'; label: string; ok: boolean; blocking: boolean }
/** What must be true before publishing. Blocking items stop the button; the rest are warnings. */
export function publishChecklist(x: { eventType: EventType; registrationMode: RegistrationMode; competitions: number; waivers: number; hasClose: boolean; hasVenue: boolean; hasLink: boolean }): PublishCheck[] {
  const out: PublishCheck[] = [];
  // Only tournaments need competitions; a feast, clinic or demonstration does not.
  if (x.eventType === 'tournament') out.push({ key: 'competitions', label: 'At least one competition is set up', ok: x.competitions > 0, blocking: true });
  // A waiver is only needed when people register on BuhurtOS.
  if (x.registrationMode === 'buhuros') {
    out.push({ key: 'waiver', label: 'A waiver is loaded (people must accept it to register)', ok: x.waivers > 0, blocking: true });
    out.push({ key: 'close', label: 'A registration close time is set', ok: x.hasClose, blocking: false });
  }
  if (x.registrationMode === 'external') out.push({ key: 'link', label: 'The sign-up or ticket link is set', ok: x.hasLink, blocking: true });
  out.push({ key: 'venue', label: 'A venue or address is given', ok: x.hasVenue, blocking: false });
  return out;
}
