export const modules6={
"lib/scoring": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateScore = validateScore;
function finiteNonNegative(value) {
    return Number.isFinite(value) && value >= 0;
}
function validateScore(config, rounds, forfeit) {
    const errors = [];
    if (forfeit) {
        if (config.requireReasonOnForfeit && !forfeit.reason.trim())
            errors.push('A forfeit reason is required.');
        if (errors.length)
            return { valid: false, errors };
        return {
            valid: true,
            errors,
            result: {
                winnerSide: forfeit.side === 1 ? 2 : 1,
                side1Total: 0,
                side2Total: 0,
                roundsWonSide1: 0,
                roundsWonSide2: 0,
                resultType: 'forfeit',
                forfeitReason: forfeit.reason.trim()
            }
        };
    }
    if (rounds.length !== config.roundsRequired) {
        errors.push(`Exactly ${config.roundsRequired} round${config.roundsRequired === 1 ? '' : 's'} must be submitted.`);
    }
    const seen = new Set();
    for (const round of rounds) {
        if (!Number.isInteger(round.roundNumber) || round.roundNumber < 1 || round.roundNumber > config.roundsRequired) {
            errors.push(`Round ${round.roundNumber} is outside the configured range.`);
        }
        if (seen.has(round.roundNumber))
            errors.push(`Round ${round.roundNumber} is duplicated.`);
        seen.add(round.roundNumber);
        if (!finiteNonNegative(round.side1Score) || !finiteNonNegative(round.side2Score)) {
            errors.push(`Round ${round.roundNumber} contains an invalid score.`);
        }
        if (config.scoreCapPerRound !== undefined && (round.side1Score > config.scoreCapPerRound || round.side2Score > config.scoreCapPerRound)) {
            errors.push(`Round ${round.roundNumber} exceeds the score cap of ${config.scoreCapPerRound}.`);
        }
        if (!config.allowDrawRound && round.side1Score === round.side2Score) {
            errors.push(`Round ${round.roundNumber} cannot end tied.`);
        }
    }
    if (errors.length)
        return { valid: false, errors };
    const ordered = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
    const side1Total = ordered.reduce((sum, r) => sum + r.side1Score, 0);
    const side2Total = ordered.reduce((sum, r) => sum + r.side2Score, 0);
    const roundsWonSide1 = ordered.filter(r => r.side1Score > r.side2Score).length;
    const roundsWonSide2 = ordered.filter(r => r.side2Score > r.side1Score).length;
    let winnerSide = null;
    let resultType = 'points';
    if (config.kind === 'team_fight' || config.winsRequired !== undefined) {
        resultType = 'rounds';
        const winsRequired = config.winsRequired ?? Math.floor(config.roundsRequired / 2) + 1;
        if (roundsWonSide1 >= winsRequired)
            winnerSide = 1;
        else if (roundsWonSide2 >= winsRequired)
            winnerSide = 2;
        else if (roundsWonSide1 !== roundsWonSide2)
            winnerSide = roundsWonSide1 > roundsWonSide2 ? 1 : 2;
    }
    else {
        if (side1Total > side2Total)
            winnerSide = 1;
        if (side2Total > side1Total)
            winnerSide = 2;
    }
    if (winnerSide === null)
        resultType = 'draw';
    return {
        valid: true,
        errors: [],
        result: { winnerSide, side1Total, side2Total, roundsWonSide1, roundsWonSide2, resultType }
    };
}

},
"lib/setup": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimFirstSuperAdmin = claimFirstSuperAdmin;
exports.listOrganizations = listOrganizations;
exports.createOrganization = createOrganization;
exports.listSeasons = listSeasons;
exports.createSeason = createSeason;
exports.listEvents = listEvents;
exports.createEvent = createEvent;
const supabase_1 = require("./supabase");
async function claimFirstSuperAdmin() {
    if (!supabase_1.supabase)
        return true;
    const { data, error } = await supabase_1.supabase.rpc('claim_first_super_admin');
    if (error)
        throw error;
    return Boolean(data);
}
async function listOrganizations() {
    if (!supabase_1.supabase)
        return [];
    const { data, error } = await supabase_1.supabase.from('organizations').select('id,name,short_name,region').order('name');
    if (error)
        throw error;
    return (data ?? []).map((row) => ({ id: row.id, name: row.name, shortName: row.short_name, region: row.region }));
}
async function createOrganization(input) {
    if (!supabase_1.supabase)
        return { id: crypto.randomUUID(), name: input.name, shortName: input.shortName, region: input.region };
    const { data, error } = await supabase_1.supabase.from('organizations').insert({ name: input.name, short_name: input.shortName, region: input.region, created_by: input.userId, last_edited_by: input.userId }).select('id,name,short_name,region').single();
    if (error)
        throw error;
    const { error: membershipError } = await supabase_1.supabase.from('organization_memberships').insert({ organization_id: data.id, user_id: input.userId, role: 'organization_admin' });
    if (membershipError)
        throw membershipError;
    return { id: data.id, name: data.name, shortName: data.short_name, region: data.region };
}
async function listSeasons(organizationId) {
    if (!supabase_1.supabase)
        return [];
    const { data, error } = await supabase_1.supabase.from('seasons').select('id,organization_id,name,starts_at,ends_at,status').eq('organization_id', organizationId).order('starts_at', { ascending: false });
    if (error)
        throw error;
    return (data ?? []).map((row) => ({ id: row.id, organizationId: row.organization_id, name: row.name, startsAt: row.starts_at, endsAt: row.ends_at, status: row.status }));
}
async function createSeason(input) {
    if (!supabase_1.supabase)
        return { id: crypto.randomUUID(), organizationId: input.organizationId, name: input.name, startsAt: input.startsAt, endsAt: input.endsAt, status: 'active' };
    const { data, error } = await supabase_1.supabase.from('seasons').insert({ organization_id: input.organizationId, name: input.name, starts_at: input.startsAt, ends_at: input.endsAt, status: 'active', created_by: input.userId, last_edited_by: input.userId }).select('*').single();
    if (error)
        throw error;
    return { id: data.id, organizationId: data.organization_id, name: data.name, startsAt: data.starts_at, endsAt: data.ends_at, status: data.status };
}
async function listEvents(organizationId) {
    if (!supabase_1.supabase)
        return [];
    const { data, error } = await supabase_1.supabase.from('events').select('id,name,venue,starts_at,status').eq('organization_id', organizationId).order('starts_at', { ascending: false });
    if (error)
        throw error;
    return (data ?? []).map((row) => ({ id: row.id, name: row.name, venue: row.venue, startsAt: row.starts_at, status: row.status }));
}
async function createEvent(input) {
    if (!supabase_1.supabase)
        return 'event-hacsa-demo';
    const { data, error } = await supabase_1.supabase.from('events').insert({ organization_id: input.organizationId, season_id: input.seasonId, name: input.name, venue: input.venue, starts_at: input.startsAt, ends_at: input.endsAt, timezone: input.timezone, event_type: input.eventType, standings_mode: input.standingsMode, status: 'draft', created_by: input.userId, last_edited_by: input.userId }).select('id').single();
    if (error)
        throw error;
    const { error: roleError } = await supabase_1.supabase.from('event_memberships').insert({ event_id: data.id, user_id: input.userId, role: 'event_organizer' });
    if (roleError)
        throw roleError;
    return data.id;
}

},
"lib/standings": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeEventStandings = computeEventStandings;
function computeEventStandings(event, matches, roster) {
    if (event.standingsMode === 'no_standings')
        return [];
    const rows = new Map();
    const names = new Map(roster.map(r => [r.id, r.displayName]));
    for (const match of matches.filter(m => m.eventId === event.id && m.status === 'finalized' && m.resultSummary && m.resultSummary.resultType !== 'bye')) {
        const sides = match.participants.filter(p => !p.isPlaceholder && p.rosterEntryId);
        if (sides.length < 2)
            continue;
        for (const p of sides) {
            const id = p.rosterEntryId;
            if (!rows.has(id))
                rows.set(id, { rosterEntryId: id, name: names.get(id) ?? 'Unknown', matches: 0, wins: 0, losses: 0, draws: 0, pointsFor: 0, pointsAgainst: 0, differential: 0, standingPoints: 0 });
        }
        const side1 = sides.find(p => p.sideIndex === 1)?.rosterEntryId;
        const side2 = sides.find(p => p.sideIndex === 2)?.rosterEntryId;
        if (!side1 || !side2)
            continue;
        const r1 = rows.get(side1);
        const r2 = rows.get(side2);
        const result = match.resultSummary;
        r1.matches += 1;
        r2.matches += 1;
        r1.pointsFor += result.side1Total;
        r1.pointsAgainst += result.side2Total;
        r2.pointsFor += result.side2Total;
        r2.pointsAgainst += result.side1Total;
        if (result.winnerSide === 1) {
            r1.wins += 1;
            r2.losses += 1;
            r1.standingPoints += 3;
        }
        else if (result.winnerSide === 2) {
            r2.wins += 1;
            r1.losses += 1;
            r2.standingPoints += 3;
        }
        else {
            r1.draws += 1;
            r2.draws += 1;
            r1.standingPoints += 1;
            r2.standingPoints += 1;
        }
    }
    return [...rows.values()].map(r => ({ ...r, differential: r.pointsFor - r.pointsAgainst })).sort((a, b) => b.standingPoints - a.standingPoints || b.differential - a.differential || b.pointsFor - a.pointsFor || a.name.localeCompare(b.name));
}

},
"lib/stream": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveStreamEmbed = resolveStreamEmbed;
function resolveStreamEmbed(rawUrl, parentHostname) {
    if (!rawUrl)
        return null;
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        return null;
    }
    if (url.protocol !== 'https:')
        return null;
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtube.com' || host === 'm.youtube.com') {
        const videoId = url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : url.searchParams.get('v');
        if (videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId))
            return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}` };
    }
    if (host === 'youtu.be') {
        const videoId = url.pathname.split('/').filter(Boolean)[0];
        if (videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId))
            return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}` };
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        const videoId = url.pathname.split('/').filter(Boolean).findLast(segment => /^\d+$/.test(segment));
        if (videoId)
            return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${videoId}` };
    }
    if (host === 'twitch.tv' || host === 'm.twitch.tv') {
        const parent = parentHostname || (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'videos' && /^\d+$/.test(parts[1] ?? ''))
            return { provider: 'twitch', embedUrl: `https://player.twitch.tv/?video=v${parts[1]}&parent=${encodeURIComponent(parent)}` };
        if (parts[0] && /^[A-Za-z0-9_]+$/.test(parts[0]))
            return { provider: 'twitch', embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(parts[0])}&parent=${encodeURIComponent(parent)}` };
    }
    return null;
}

},
"lib/supabase": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = exports.isSupabaseConfigured = void 0;
exports.subscribeToEvent = subscribeToEvent;
const supabase_js_1 = require("@supabase/supabase-js");
const url = undefined;
const publishableKey = (undefined || undefined);
exports.isSupabaseConfigured = Boolean(url && publishableKey);
exports.supabase = exports.isSupabaseConfigured ? (0, supabase_js_1.createClient)(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;
function subscribeToEvent(eventId, onChange) {
    if (!exports.supabase)
        return null;
    return exports.supabase
        .channel(`event:${eventId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `event_id=eq.${eventId}` }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'event_roster_entries', filter: `event_id=eq.${eventId}` }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `event_id=eq.${eventId}` }, onChange)
        .subscribe();
}

},
"lib/userContext": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadUserContext = loadUserContext;
const supabase_1 = require("./supabase");
async function loadUserContext(userId, displayName) {
    if (!supabase_1.supabase)
        return { userId, displayName, platformRoles: [], organizationRoles: [], eventRoles: [] };
    const [platform, org, event] = await Promise.all([
        supabase_1.supabase.from('platform_memberships').select('role').eq('user_id', userId),
        supabase_1.supabase.from('organization_memberships').select('organization_id,role').eq('user_id', userId),
        supabase_1.supabase.from('event_memberships').select('event_id,role,team_id').eq('user_id', userId)
    ]);
    const error = platform.error || org.error || event.error;
    if (error)
        throw error;
    return {
        userId,
        displayName,
        platformRoles: (platform.data ?? []).map(r => r.role),
        organizationRoles: (org.data ?? []).map(r => ({ organizationId: r.organization_id, role: r.role })),
        eventRoles: (event.data ?? []).map(r => ({ eventId: r.event_id, role: r.role, teamId: r.team_id ?? undefined }))
    };
}

},
"main": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const client_1 = require("react-dom/client");
const App_1 = require("./App");
const AppState_1 = require("./features/AppState");
require("./styles.css");
(0, client_1.createRoot)(document.getElementById('root')).render((0, jsx_runtime_1.jsx)(react_1.StrictMode, { children: (0, jsx_runtime_1.jsx)(AppState_1.AppStateProvider, { children: (0, jsx_runtime_1.jsx)(App_1.App, {}) }) }));
if ('serviceWorker' in navigator)
    window.addEventListener('load', () => navigator.serviceWorker.register(`${'./'}sw.js`).catch(() => undefined));

}
};
