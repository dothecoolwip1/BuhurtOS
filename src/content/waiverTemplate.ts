/**
 * The starter waiver. It is a STARTER, not legal advice: the organizer edits it and reviews it with their organization and insurer
 * before publishing. Square-bracket placeholders are filled in from the event when it is saved; any BuhurtOS cannot fill must be replaced by the organizer first.
 */
export const WAIVER_TEMPLATE_NOTICE = 'Starter waiver template. BuhurtOS does not give legal advice: review this with your organization and insurer, and change anything that does not fit your event, before using it.';

export const WAIVER_TEMPLATE_TITLE = 'Participation waiver and release';

export const WAIVER_TEMPLATE = `PARTICIPATION WAIVER, RELEASE AND ASSUMPTION OF RISK
[EVENT NAME], organized by [ORGANIZATION NAME] ("the Organizer")

1. What I am agreeing to
I am taking part in [EVENT NAME] as a fighter, volunteer or official. I have read this document, I understand it, and I am signing it freely.

2. The risks
Armoured combat (buhurt, duels and profights) is a full-contact combat sport fought with steel weapons. I understand that taking part carries serious risks, including cuts, bruises, broken bones, concussion, heat exhaustion, permanent injury and death. Protective equipment reduces these risks but does not remove them. I accept these risks.

3. My equipment and fitness
I confirm that my armour and weapons meet the rules the Organizer has announced for this event, that I will submit them for inspection when asked, and that I am medically fit to take part. I will tell the Organizer or the medic about any condition that could affect my safety or the safety of others.

4. Rules and marshals
I will follow the published rules of the event and the instructions of the marshals, medic and Organizer. I understand that I can be removed from the event for unsafe conduct, with no refund.

5. Release
To the fullest extent the law of [PROVINCE / STATE] allows, I release [ORGANIZATION NAME], its officers, volunteers, marshals, medics, sponsors and the venue [VENUE NAME] from claims for injury, loss or damage arising from my participation, including claims based on their negligence, except where the law does not allow such a release.

6. Insurance
I understand that I am responsible for my own insurance cover, and that the Organizer's requirements about insurance apply to me.

7. Photographs and results
I agree that photographs, video and results from the event may be published, including on BuhurtOS, as part of the public record of the sport.

8. Emergency treatment
If I am injured and cannot speak for myself, I consent to emergency first aid and medical treatment arranged by the Organizer, at my own cost.

By typing my name and confirming on BuhurtOS, I sign this waiver electronically for this event.`;

/** The [PLACEHOLDERS] still in a text, so the organizer is told what to replace before saving. */
export function templatePlaceholders(text: string): string[] {
  return [...new Set(text.match(/\[[A-Z][A-Z /]+\]/g) ?? [])];
}


/** What BuhurtOS knows about the event, to fill the starter template's placeholders. Empty values never replace anything. */
export interface WaiverValues { eventName?: string | null; organization?: string | null; venue?: string | null; region?: string | null }

const PLACEHOLDER_KEY: Record<string, keyof WaiverValues> = {
  '[EVENT NAME]': 'eventName', '[ORGANIZATION NAME]': 'organization', '[VENUE NAME]': 'venue', '[PROVINCE / STATE]': 'region'
};

/**
 * Fills the placeholders the event can answer, so organizers keep the [BRACKETS] in the text and BuhurtOS writes in the real words when it is saved.
 * The saved version always holds the finished wording (a signed waiver must never change later when an event is renamed). `missing` are the
 * placeholders that stay because the event has no value for them yet, or that BuhurtOS does not know (the organizer's own brackets).
 */
export function fillWaiverPlaceholders(text: string, values: WaiverValues): { text: string; filled: string[]; missing: string[] } {
  const filled: string[] = [];
  const out = text.replace(/\[[A-Z][A-Z /]+\]/g, token => {
    const key = PLACEHOLDER_KEY[token];
    const v = key ? values[key]?.trim() : '';
    if (!v) return token;
    if (!filled.includes(token)) filled.push(token);
    return v;
  });
  return { text: out, filled, missing: templatePlaceholders(out) };
}

/** The same, said for a person: why a placeholder is still there. */
export function missingHint(token: string): string {
  const hints: Record<string, string> = {
    '[EVENT NAME]': 'the event has no name yet',
    '[ORGANIZATION NAME]': 'this event is not attached to an organization; type the organizer\'s name',
    '[VENUE NAME]': 'the event has no venue yet; add one in Event details below, or type it here',
    '[PROVINCE / STATE]': 'the event has no province or state yet; add one in Event details below, or type it here'
  };
  return `${token}: ${hints[token] ?? 'type your own words'}`;
}
