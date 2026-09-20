export const modules4={
"lib/adminActions": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addGhostFighter = addGhostFighter;
exports.saveBracketPlan = saveBracketPlan;
const supabase_1 = require("./supabase");
async function addGhostFighter(event, displayName, teamId) {
    const row = {
        id: crypto.randomUUID(), organizationId: event.organizationId, eventId: event.id, teamId, entryType: 'ghost_fighter', displayName,
        checkedIn: false, armorCleared: false, medicalCleared: false, waiverConfirmed: false, weighInCleared: false, attendanceStatus: 'registered'
    };
    if (!supabase_1.supabase) {
        const key = 'buhurtos-demo-ghosts';
        const current = JSON.parse(localStorage.getItem(key) ?? '[]');
        localStorage.setItem(key, JSON.stringify([...current, row]));
        return row;
    }
    const { data, error } = await supabase_1.supabase.from('event_roster_entries').insert({ organization_id: event.organizationId, event_id: event.id, team_id: teamId ?? null, entry_type: 'ghost_fighter', display_name: displayName, ghost_original_name: displayName }).select('*').single();
    if (error)
        throw error;
    return { ...row, id: data.id };
}
async function saveBracketPlan(event, plan, options) {
    if (!supabase_1.supabase) {
        localStorage.setItem('buhurtos-demo-bracket-matches', JSON.stringify(plan.matches));
        return options.id;
    }
    const { data, error } = await supabase_1.supabase.rpc('save_bracket_plan', {
        p_bracket: { id: options.id, eventId: event.id, fightCardId: options.fightCardId ?? '', name: options.name, format: 'single_elimination', category: options.category, metadata: { generatedAt: new Date().toISOString(), antiFratricide: true } },
        p_matches: plan.matches
    });
    if (error)
        throw error;
    return data;
}

},
"lib/auth": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signIn = signIn;
exports.signOut = signOut;
exports.sendMagicLink = sendMagicLink;
const supabase_1 = require("./supabase");
async function signIn(email, password) {
    if (!supabase_1.supabase)
        throw new Error('Supabase is not configured. Demo mode is available instead.');
    const { error } = await supabase_1.supabase.auth.signInWithPassword({ email, password });
    if (error)
        throw error;
}
async function signOut() {
    if (!supabase_1.supabase)
        return;
    const { error } = await supabase_1.supabase.auth.signOut();
    if (error)
        throw error;
}
async function sendMagicLink(email) {
    if (!supabase_1.supabase)
        throw new Error('Supabase is not configured.');
    const { error } = await supabase_1.supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/login${window.location.search}` } });
    if (error)
        throw error;
}

},
"lib/bracket": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.placeSeedsAntiFratricide = placeSeedsAntiFratricide;
exports.generateSingleElimination = generateSingleElimination;
exports.advanceWinner = advanceWinner;
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `local-${Math.random().toString(36).slice(2)}-${Date.now()}`;
function nextPowerOfTwo(value) {
    let n = 1;
    while (n < value)
        n *= 2;
    return n;
}
function bracketSeedOrder(size) {
    let order = [1, 2];
    for (let current = 4; current <= size; current *= 2) {
        const mirror = current + 1;
        order = order.flatMap(seed => [seed, mirror - seed]);
    }
    return order;
}
function sameTeamCost(slots, size) {
    let cost = 0;
    for (let a = 0; a < slots.length; a += 1) {
        const left = slots[a];
        if (!left?.entry.teamId)
            continue;
        for (let b = a + 1; b < slots.length; b += 1) {
            const right = slots[b];
            if (!right || right.entry.teamId !== left.entry.teamId)
                continue;
            if (Math.floor(a / 2) === Math.floor(b / 2))
                cost += 100000;
            else if (Math.floor(a / Math.max(2, size / 4)) === Math.floor(b / Math.max(2, size / 4)))
                cost += 1000;
            else if (Math.floor(a / Math.max(2, size / 2)) === Math.floor(b / Math.max(2, size / 2)))
                cost += 100;
            else
                cost += 1;
        }
    }
    return cost;
}
function placeSeedsAntiFratricide(entries) {
    const size = nextPowerOfTwo(Math.max(2, entries.length));
    const slots = Array(size).fill(null);
    const ordered = [...entries].sort((a, b) => a.seed - b.seed || a.entry.displayName.localeCompare(b.entry.displayName));
    const order = bracketSeedOrder(size);
    const targetSlot = new Map();
    ordered.forEach((candidate, index) => {
        const bracketSeed = index + 1;
        const slot = order.indexOf(bracketSeed);
        slots[slot] = candidate;
        targetSlot.set(candidate.entry.id, slot);
    });
    const occupied = slots.map((value, index) => value ? index : -1).filter(index => index >= 0);
    const score = () => {
        const team = sameTeamCost(slots, size);
        const seedDeviation = occupied.reduce((sum, slot) => {
            const item = slots[slot];
            if (!item)
                return sum;
            return sum + Math.abs(slot - (targetSlot.get(item.entry.id) ?? slot));
        }, 0);
        return team + seedDeviation * 2;
    };
    for (let pass = 0; pass < Math.min(64, occupied.length * occupied.length); pass += 1) {
        const base = score();
        let best = base;
        let bestSwap = null;
        for (let i = 0; i < occupied.length; i += 1) {
            for (let j = i + 1; j < occupied.length; j += 1) {
                const a = occupied[i];
                const b = occupied[j];
                [slots[a], slots[b]] = [slots[b], slots[a]];
                const candidateScore = score();
                [slots[a], slots[b]] = [slots[b], slots[a]];
                if (candidateScore < best) {
                    best = candidateScore;
                    bestSwap = [a, b];
                }
            }
        }
        if (!bestSwap)
            break;
        [slots[bestSwap[0]], slots[bestSwap[1]]] = [slots[bestSwap[1]], slots[bestSwap[0]]];
    }
    return slots;
}
function generateSingleElimination(params) {
    if (params.entries.length < 2)
        throw new Error('At least two competitors are required to generate a bracket.');
    const slots = placeSeedsAntiFratricide(params.entries);
    const size = slots.length;
    const rounds = Math.log2(size);
    const matchesByRound = [];
    for (let round = 1; round <= rounds; round += 1) {
        const count = size / Math.pow(2, round);
        const roundMatches = [];
        for (let index = 0; index < count; index += 1) {
            roundMatches.push({
                id: uuid(),
                organizationId: params.organizationId,
                seasonId: params.seasonId,
                eventId: params.eventId,
                fightCardId: params.fightCardId,
                bracketId: params.bracketId,
                label: round === rounds ? 'Final' : `Round ${round} • Match ${index + 1}`,
                category: params.category,
                matchType: params.matchType,
                scoringConfig: params.scoringConfig,
                status: 'scheduled',
                stage: round === rounds ? 'final' : 'bracket',
                scheduledOrder: round * 100 + index,
                bracketRound: round,
                bracketSlot: `${round}-${index + 1}`,
                participants: [],
                rounds: []
            });
        }
        matchesByRound.push(roundMatches);
    }
    const firstRound = matchesByRound[0];
    for (let i = 0; i < firstRound.length; i += 1) {
        const a = slots[i * 2];
        const b = slots[i * 2 + 1];
        firstRound[i].participants = [
            a ? { rosterEntryId: a.entry.id, sideIndex: 1, seed: a.seed } : { sideIndex: 1, isPlaceholder: true, placeholderLabel: 'BYE' },
            b ? { rosterEntryId: b.entry.id, sideIndex: 2, seed: b.seed } : { sideIndex: 2, isPlaceholder: true, placeholderLabel: 'BYE' }
        ];
    }
    for (let roundIndex = 0; roundIndex < matchesByRound.length - 1; roundIndex += 1) {
        const round = matchesByRound[roundIndex];
        const next = matchesByRound[roundIndex + 1];
        for (let i = 0; i < round.length; i += 1) {
            const target = next[Math.floor(i / 2)];
            const slot = (i % 2 === 0 ? 1 : 2);
            round[i].winnerAdvancesToMatchId = target.id;
            round[i].winnerAdvancesToSlot = slot;
            target.participants.push({ sideIndex: slot, isPlaceholder: true, placeholderLabel: `Winner ${round[i].label}`, sourceMatchId: round[i].id, sourceSlot: slot, isWinnerSource: true });
        }
    }
    let allMatches = matchesByRound.flat();
    for (const sourceId of firstRound.map(match => match.id)) {
        const match = allMatches.find(item => item.id === sourceId);
        const real = match.participants.filter(p => !p.isPlaceholder && p.rosterEntryId);
        const byes = match.participants.filter(p => p.isPlaceholder && p.placeholderLabel === 'BYE');
        if (real.length === 1 && byes.length === 1) {
            const winner = real[0];
            match.status = 'finalized';
            match.resultSummary = {
                winnerSide: winner.sideIndex,
                side1Total: 0,
                side2Total: 0,
                roundsWonSide1: 0,
                roundsWonSide2: 0,
                resultType: 'bye'
            };
            allMatches = advanceWinner(allMatches, match.id, winner.rosterEntryId);
        }
    }
    return { size, rounds, matches: allMatches };
}
function advanceWinner(matches, completedMatchId, winnerRosterEntryId) {
    const copy = structuredClone(matches);
    const source = copy.find(m => m.id === completedMatchId);
    if (!source?.winnerAdvancesToMatchId || !source.winnerAdvancesToSlot)
        return copy;
    const target = copy.find(m => m.id === source.winnerAdvancesToMatchId);
    if (!target)
        throw new Error('Bracket target match is missing.');
    const slot = source.winnerAdvancesToSlot;
    target.participants = target.participants.filter(p => p.sideIndex !== slot);
    target.participants.push({ rosterEntryId: winnerRosterEntryId, sideIndex: slot, sourceMatchId: source.id, sourceSlot: slot, isWinnerSource: true });
    return copy;
}

},
"lib/bracketView": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupBracketRounds = groupBracketRounds;
function groupBracketRounds(matches) {
    const map = new Map();
    for (const match of matches.filter(m => m.bracketRound)) {
        const round = match.bracketRound;
        if (!map.has(round))
            map.set(round, []);
        map.get(round).push(match);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([round, roundMatches]) => ({ round, matches: roundMatches.sort((a, b) => a.scheduledOrder - b.scheduledOrder) }));
}

},
"lib/compliance": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkCompliance = checkCompliance;
exports.assertParticipantsCompliant = assertParticipantsCompliant;
function checkCompliance(entry) {
    const missing = [];
    if (!entry.checkedIn)
        missing.push('check in');
    if (!entry.armorCleared)
        missing.push('armor clearance');
    if (!entry.medicalCleared)
        missing.push('medical clearance');
    if (!entry.waiverConfirmed)
        missing.push('waiver');
    if (entry.attendanceStatus === 'withdrawn' || entry.attendanceStatus === 'no_show')
        missing.push(entry.attendanceStatus.replace('_', ' '));
    return { eligible: missing.length === 0, missing };
}
function assertParticipantsCompliant(entries) {
    const blocked = entries.map(entry => ({ entry, result: checkCompliance(entry) })).filter(item => !item.result.eligible);
    if (blocked.length) {
        throw new Error(blocked.map(item => `${item.entry.displayName}: ${item.result.missing.join(', ')}`).join('; '));
    }
}

},
"lib/export": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.standingsCsv = standingsCsv;
exports.matchesCsv = matchesCsv;
exports.downloadText = downloadText;
exports.openPrintableReport = openPrintableReport;
function csvCell(value) {
    const text = String(value ?? '');
    return /[",
]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function standingsCsv(rows) {
    const header = ['Rank', 'Competitor', 'Matches', 'Wins', 'Losses', 'Draws', 'Points For', 'Points Against', 'Differential', 'Standing Points'];
    const lines = rows.map((r, index) => [index + 1, r.name, r.matches, r.wins, r.losses, r.draws, r.pointsFor, r.pointsAgainst, r.differential, r.standingPoints]);
    return [header, ...lines].map(row => row.map(csvCell).join(',')).join('
');
}
function matchesCsv(matches) {
    const header = ['Order', 'Label', 'Category', 'Stage', 'Status', 'Winner Side', 'Side 1 Total', 'Side 2 Total'];
    const lines = matches.map(m => [m.scheduledOrder, m.label, m.category, m.stage, m.status, m.resultSummary?.winnerSide ?? '', m.resultSummary?.side1Total ?? '', m.resultSummary?.side2Total ?? '']);
    return [header, ...lines].map(row => row.map(csvCell).join(',')).join('
');
}
function downloadText(filename, content, mime = 'text/csv;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
function openPrintableReport(title, bodyHtml) {
    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (!win)
        throw new Error('Pop-up blocked. Allow pop-ups to create the printable report.');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui;padding:32px;color:#111}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}h1{margin-top:0}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / Save PDF</button><h1>${title}</h1>${bodyHtml}</body></html>`);
    win.document.close();
}

},
"lib/memberAdmin": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEventMemberships = listEventMemberships;
exports.inviteEventMember = inviteEventMember;
exports.removeEventMembership = removeEventMembership;
const supabase_1 = require("./supabase");
async function listEventMemberships(eventId) {
    if (!supabase_1.supabase)
        return [];
    const { data, error } = await supabase_1.supabase.from('event_memberships').select('id,user_id,role,team_id,profiles(display_name)').eq('event_id', eventId).order('role');
    if (error)
        throw error;
    return (data ?? []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        role: row.role,
        teamId: row.team_id ?? undefined,
        displayName: (Array.isArray(row.profiles) ? row.profiles[0]?.display_name : row.profiles?.display_name) || row.user_id.slice(0, 8)
    }));
}
async function inviteEventMember(input) {
    if (!supabase_1.supabase)
        return { invited: true };
    const { data, error } = await supabase_1.supabase.functions.invoke('invite-event-member', { body: input });
    if (error)
        throw error;
    if (data?.error)
        throw new Error(data.error);
    return { invited: Boolean(data?.invited) };
}
async function removeEventMembership(id) {
    if (!supabase_1.supabase)
        return;
    const { error } = await supabase_1.supabase.from('event_memberships').delete().eq('id', id);
    if (error)
        throw error;
}

}
};
