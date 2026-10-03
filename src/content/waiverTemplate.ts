/**
 * The starter waiver. It is a STARTER, not legal advice: the organizer edits it and reviews it with their organization and insurer
 * before publishing. Square-bracket placeholders must be replaced before it can be saved.
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
