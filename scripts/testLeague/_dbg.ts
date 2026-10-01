import { buildWorld, registrations } from './world';
const w = buildWorld();
console.log('rumble seed', w.rumbleSeed);
for (const e of [...w.events, w.rumble]) {
  const men = [...e.attendees].filter(i => w.fighters[i].sex === 'male').length;
  const entries = e.comps.reduce((n, c) => n + c.entries.length, 0);
  const merc = e.comps.reduce((n, c) => n + c.entries.reduce((m, x) => m + x.roster.filter(s => s.role === 'mercenary').length, 0), 0);
  console.log(e.event.name.padEnd(36), 'unique', e.attendees.size, 'men', men, 'comps', e.comps.length, 'entries', entries, 'regs', registrations(e), 'merc', merc,
    e.comps.map(c => `${c.div.gender[0]}${c.div.cat}:${c.entries.length}`).join(' '));
}
const wins = new Map<string, number>();
let matches = 0;
for (const e of w.events) for (const s of e.sims) for (const p of s.phases) matches += p.length;
console.log('hist matches', matches, 'rumble matches', w.rumble.sims.reduce((n, s) => n + s.phases.reduce((m, p) => m + p.length, 0), 0));
void wins;
