-- Red Deer Rumble 2026 as a PRIVATE DRAFT. Facts come from the owner's live registration form (pasted 2026-10-01).
-- Nothing is public until an organizer sets status = 'published'. Tier is left unset on every competition on purpose.
-- The waiver text is the owner's, verbatim, and must not be edited: add a new version instead.
with ev as (
  insert into public.events (slug, name, description, event_type, status, venue, address, city, region, country, timezone, fee_cents, fee_province, fee_note, starts_on, ends_on, registration_closes_at)
  values ('red-deer-rumble-2026', 'Red Deer Rumble 2026',
$d$Saturday, November 14th, 10 am to 6 pm. Sunday, November 15th, 10 am to 6 pm. Weapons check at 8:00 am. Safety meeting at 9:30 am on both days.

A full tournament open to anyone. Camping is available on site.

Red Deer Rumble follows Buhurt International rulesets for every category included in BI. Sabre and Greatsword (in Marathon) follow HACSA rulesets. This is announced as an official BI tournament: please create a fighter profile on the BI website if you do not have one. Fighters without a BI fighter profile will be moved into a separate bracket and will likely not be competing for medals.

Fighters not part of HACSA must show proof of insurance and fill out a liability form. Under the HACSA/MCC agreement, MCC members are not required to show proof of insurance or sign new forms. Failure to meet these requirements will result in fights being denied. Fighters without insurance who still want to take part can contact info@hacsacanada.com for the forms to join as a temporary HACSA member.

Teams must be made before registration closes. Teams are final. A fighter who is not in a team will not fight. Fighters who want to join a team can say so and will be placed.

Marathon relay: a 2-fighter team event (solo is allowed). Each fighter does one round of each category, in order: Longsword, Sword and Shield, Sabre, Polearm, Sword and Buckler, Short Axe (or Greatsword if both teams agree and there are enough). Only 10 seconds between rounds. Round winners add up: 2 points for a win, 1 for a tie, 0 for a loss. The team with the highest score wins the match.

Profight: weight categories. Classes with too few fighters will be handled on the day.

Volunteers who assist fighters must fill out a separate safety, liability and tracking form.$d$,
    'tournament', 'draft', 'Horse In Hand Ranch', '39506 Highway 2 Service Rd, Blackfalds AB', 'Blackfalds', 'AB', 'CA', 'America/Edmonton',
    4000, 'AB',
    'All Alberta fighters pay a $40 fighter fee. Fighters from outside the province, and people who mostly volunteer (fighting only one category), do not pay. Pay by e-transfer to reddeer.reavers@gmail.com before November 13th, 2026, or in cash at the tournament.',
    date '2026-11-14', date '2026-11-15', timestamptz '2026-11-09 06:59:00+00')
  returning id
), wv as (
  insert into public.waiver_versions (event_id, version, title, body)
  select id, 1, 'Liability Waiver', $w$By agreeing to the following I (also referred to as “Participant”), having attained the age of majority in Alberta and having read and understood the contents of this document, do, by the affixing of my signature to this document, consent to the provisions therein. I understand and agree that this document is intended to be as broad and inclusive as possible under the law, and that if any portion of this document is rendered invalid, the balance shall continue in full legal force and effect.

It is my intention to participate in activities organized by  Historical Armored Combat Sports Association. During these activities I will be, of my own choosing, involved as a participant in various medieval re-enactment activities, heavy armoured combat, reproductive combat practices and techniques which may incidentally cause bodily harm. These events may include but are not limited to  martialing or refereeing activities, dancing, feasts, arts & crafts, workshops, seminars and performances. I do hereby state that I have no medical condition that prevents me from taking part in any activity I participate in, in conjunction with or for, the Heavy Armoured Combat Society of Alberta or the Historical Armored Combat Sports Association. I do also abide by any insurance requirements given to me by the  Historical Armored Combat Sports Association , its members, or its directors. If I am under 18 years of age, I will have a parent or guardian additionally sign all required forms knowing and accepting fully the risks involved in this activity, which shall be under the close observation of said signing authority at all times.

I recognize that taking part in these activities may involve varying degrees of risk, and that the risk of damages, injury, or death to myself during these activities may exist. I also recognize that the standards and practices of the company are intended to minimize risk but cannot eliminate it. I hereby accept and assume any such risks and liabilities, however caused. I agree to familiarize myself with and abide by any relevant and applicable standards, bylaws and practices of   the company before taking part in any activity organized by the company. I also agree that, if at any time I feel the activity I am taking part in is unsafe, I will immediately take all precautions to avoid said unsafe activity, refuse to participate further, and report it to a member or director of Historical Armored Combat Sports Association.

I agree to indemnify, hold harmless and covenant not to take legal action against  Historical Armored Combat Sports Association including its organizers and respective agents, officials, servants and representatives from and against all claims, actions, costs, expenses and demands in respect to death, injury, loss or damage to my person or property, howsoever caused, arising out of or in connection with my taking part in activities organized by the company, and notwithstanding that the same may have contributed to or been occasioned by the negligence of said bodies, or any of their agents, officials, servants or representatives. I understand and agree that this waiver is to be binding on myself, my heirs, executors and assigns.$w$
  from ev returning id
)
insert into public.competitions (event_id, name, category, gender, ruleset, sort)
select ev.id, c.name, c.category, c.gender, c.ruleset, c.sort
from ev, (values
  ('Melee 3v3 (men)',          '3v3',          'men',   'Buhurt International: Buhurt Rules V.26.4.1', 10),
  ('Melee 5v5 (men)',          '5v5',          'men',   'Buhurt International: Buhurt Rules V.26.4.1', 11),
  ('Melee (women)',            '5v5',          'women', 'Buhurt International: Buhurt Rules V.26.4.1', 12),
  ('Longsword (men)',          'longsword',    'men',   'Buhurt International: Duels rules V.26.4', 20),
  ('Longsword (women)',        'longsword',    'women', 'Buhurt International: Duels rules V.26.4', 21),
  ('Sword and Shield (men)',   'sword_shield', 'men',   'Buhurt International: Duels rules V.26.4', 22),
  ('Sword and Shield (women)', 'sword_shield', 'women', 'Buhurt International: Duels rules V.26.4', 23),
  ('Sword and Buckler (men)',  'buckler',      'men',   'Buhurt International: Duels rules V.26.4', 24),
  ('Sword and Buckler (women)','buckler',      'women', 'Buhurt International: Duels rules V.26.4', 25),
  ('Polearm (men)',            'polearm',      'men',   'Buhurt International: Duels rules V.26.4', 26),
  ('Polearm (women)',          'polearm',      'women', 'Buhurt International: Duels rules V.26.4', 27),
  ('Sabre (men)',              'sabre',        'men',   'HACSA ruleset (not loaded yet)', 30),
  ('Sabre (women)',            'sabre',        'women', 'HACSA ruleset (not loaded yet)', 31),
  ('Triathlon',                'triathlon',    'open',  null, 32),
  ('Marathon relay',           'marathon',     'open',  'HACSA ruleset (not loaded yet)', 33),
  ('Profight (men)',           'profight',     'men',   'Buhurt International: Outrance Rules V.26.4', 40),
  ('Profight (women)',         'profight',     'women', 'Buhurt International: Outrance Rules V.26.4', 41)
) as c(name, category, gender, ruleset, sort);
