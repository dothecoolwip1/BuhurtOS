// INVENTED test documents for the Pack 22 importer, database gate and browser tests. They are NOT Buhurt International (or any real body's)
// rules: every page says so. They only reproduce the shapes real rulebooks have: a title page with version and date, headers and footers,
// numbered sections with titles, wrapped paragraphs, bullets, a long provision, a table and an appendix.
const banner = 'EXAMPLE BODY · TEST DOCUMENT · NOT REAL RULES';
const longText = Array.from({ length: 9 }, (_, i) => `Paragraph ${i + 1} of this long provision exists so the rule page can be tested with a lot of text on a phone. It repeats the same invented wording about list conduct, the marshal's signals and the order of bouts, and it means nothing outside this test.`).join('\n\n');
export const DOCS = {
  'r1/marshal__example-combat-rules': { title: 'Example Combat Rules', version: 'V.1.0', date: '01.03.2026', sections: [
    ['1', 'General', [['1.1', 'Scope', 'These invented rules apply to every example bout held under the Example Body.'], ['1.2', 'Grounded fighter', 'A fighter is grounded when any part of the body other than the feet touches the ground. A grounded fighter takes no further part in the round.']]],
    ['2', 'Prohibited actions', [['2.1', 'Prohibited targets', 'Strikes to the back of the knee, the neck and the feet are prohibited. See 1.2 for grounded fighters.'], ['2.2', 'Grappling', 'Grappling is allowed only while both fighters stand. Throws onto the head are prohibited.'], ['2.3', 'Two-handed weapons', 'A two-handed weapon must be held with both hands when striking. A shield may not be used to strike with its edge.']]],
    ['3', 'Penalties', [['3.1', 'Warnings', 'The marshal may give a verbal warning for a minor breach.'], ['3.2', 'Cards', 'A yellow card is shown for a repeated breach; a red card removes the fighter from the bout (see 3.1).'], ['3.3', 'Order of bouts', longText]]],
    ['4', 'Equipment', [['4.1', 'Helmet', 'Every fighter wears a helmet that covers the whole head.'], ['4.2', 'Shield sizes', 'Shield sizes are listed in this table.\nShield      Maximum      Note\nRound       60 cm        Diameter\nKite        90 cm        Height']]]
  ] },
  'r1/tournament__example-event-regulations': { title: 'Example Event Regulations', version: 'V.2.0', date: '15.02.2026', sections: [
    ['1', 'Registration', [['1.1', 'Deadline', 'Teams register at least ten days before the example event.'], ['1.2', 'Fighters', 'Each fighter is registered by name before the first bout.']]],
    ['2', 'Results', [['2.1', 'Protests', 'A captain may raise a protest with the head marshal within ten minutes of the bout ending.']]]
  ] },
  // Release 2: a changed edition of the combat rules, so the gate can test supersession and history.
  'r2/marshal__example-combat-rules': { title: 'Example Combat Rules', version: 'V.1.1', date: '01.06.2026', sections: [
    ['1', 'General', [['1.1', 'Scope', 'These invented rules apply to every example bout and every example tournament held under the Example Body.'], ['1.2', 'Grounded fighter', 'A fighter is grounded when any part of the body other than the feet touches the ground. A grounded fighter takes no further part in the round.']]],
    ['2', 'Prohibited actions', [['2.1', 'Prohibited targets', 'Strikes to the back of the knee, the neck, the groin and the feet are prohibited. See 1.2 for grounded fighters.'], ['2.2', 'Grappling', 'Grappling is allowed only while both fighters stand. Throws onto the head are prohibited.'], ['2.3', 'Two-handed weapons', 'A two-handed weapon must be held with both hands when striking. A shield may not be used to strike with its edge.']]],
    ['3', 'Penalties', [['3.1', 'Warnings', 'The marshal may give a verbal warning for a minor breach.'], ['3.2', 'Cards', 'A yellow card is shown for a repeated breach; a red card removes the fighter from the bout (see 3.1).']]],
    ['4', 'Equipment', [['4.1', 'Helmet', 'Every fighter wears a helmet that covers the whole head and the neck.']]]
  ] }
};
export function html(doc) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = doc.sections.map(([n, t, rules]) => `<h2>${n}. ${esc(t)}</h2>` + rules.map(([rn, rt, txt]) => `<h3>${rn} ${esc(rt)}</h3>` + txt.split('\n\n').map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')).join('')).join('');
  return `<!doctype html><meta charset="utf-8"><style>body{font:12pt serif;margin:0} h1{font-size:20pt} h2{font-size:14pt;margin:18pt 0 6pt} h3{font-size:12pt;margin:10pt 0 4pt} p{margin:0 0 6pt;white-space:pre-wrap}</style>
<h1>${esc(doc.title)}</h1><p>${doc.version} · ${doc.date}</p><p>Invented for software testing only.</p>${body}`;
}
export const BANNER = banner;
