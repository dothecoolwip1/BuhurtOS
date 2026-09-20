export const modules5={
"lib/offlineQueue": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueMutation = enqueueMutation;
exports.listMutations = listMutations;
exports.updateMutation = updateMutation;
exports.removeMutation = removeMutation;
exports.flushMutationQueue = flushMutationQueue;
exports.retryMutation = retryMutation;
exports.discardMutation = discardMutation;
const DB_NAME = 'buhurtos-offline';
const STORE = 'mutations';
const memory = new Map();
function hasIndexedDb() {
    return typeof indexedDB !== 'undefined';
}
function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE))
                db.createObjectStore(STORE, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function withStore(mode, work) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}
async function enqueueMutation(input) {
    const item = {
        ...input,
        id: globalThis.crypto?.randomUUID?.() ?? `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: new Date().toISOString(),
        attempts: 0,
        state: 'queued'
    };
    if (!hasIndexedDb())
        memory.set(item.id, item);
    else
        await withStore('readwrite', store => store.put(item));
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
            const syncManager = registration.sync;
            return syncManager?.register('buhurtos-sync');
        }).catch(() => undefined);
    }
    return item;
}
async function listMutations() {
    if (!hasIndexedDb())
        return [...memory.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const rows = await withStore('readonly', store => store.getAll());
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
async function updateMutation(item) {
    if (!hasIndexedDb()) {
        memory.set(item.id, item);
        return;
    }
    await withStore('readwrite', store => store.put(item));
}
async function removeMutation(id) {
    if (!hasIndexedDb()) {
        memory.delete(id);
        return;
    }
    await withStore('readwrite', store => store.delete(id));
}
async function flushMutationQueue(executor) {
    const queued = await listMutations();
    let synced = 0;
    let conflicts = 0;
    let failed = 0;
    for (const item of queued.filter(m => m.state === 'queued' || m.state === 'failed')) {
        const syncing = { ...item, state: 'syncing', attempts: item.attempts + 1 };
        await updateMutation(syncing);
        try {
            const result = await executor(syncing);
            if (result.ok === true) {
                await removeMutation(item.id);
                synced += 1;
            }
            else if (result.conflict) {
                await updateMutation({ ...syncing, state: 'conflict', lastError: result.error });
                conflicts += 1;
            }
            else {
                await updateMutation({ ...syncing, state: 'failed', lastError: result.error });
                failed += 1;
            }
        }
        catch (error) {
            await updateMutation({ ...syncing, state: 'failed', lastError: error instanceof Error ? error.message : 'Unknown sync error' });
            failed += 1;
        }
    }
    return { synced, conflicts, failed };
}
async function retryMutation(id) {
    const item = (await listMutations()).find(row => row.id === id);
    if (!item)
        return;
    await updateMutation({ ...item, state: 'queued', lastError: undefined });
}
async function discardMutation(id) {
    await removeMutation(id);
}

},
"lib/permissions": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPermission = hasPermission;
const EVENT_ROLE_PERMISSIONS = {
    event_organizer: ['event.view_private', 'event.manage', 'roster.manage', 'match.manage', 'match.score', 'bracket.manage', 'announcement.manage', 'discipline.manage', 'notes.team'],
    field_marshal: ['event.view_private', 'roster.manage', 'match.manage', 'match.score', 'announcement.manage', 'discipline.manage', 'notes.team'],
    assistant_marshal: ['event.view_private', 'roster.manage', 'match.manage', 'match.score', 'announcement.manage', 'notes.team'],
    team_captain: ['event.view_private', 'notes.team'],
    fighter: ['event.view_private', 'profile.self']
};
function hasPermission(user, permission, eventId, organizationId) {
    if (!user)
        return false;
    if (user.platformRoles.includes('platform_super_admin'))
        return true;
    if (organizationId && user.organizationRoles.some(r => r.organizationId === organizationId && r.role === 'organization_admin'))
        return true;
    if (!eventId)
        return permission === 'profile.self';
    return user.eventRoles.some(r => r.eventId === eventId && EVENT_ROLE_PERMISSIONS[r.role].includes(permission));
}

},
"lib/registration": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitRegistration = submitRegistration;
exports.uploadWaiver = uploadWaiver;
exports.createRegistrationCheckout = createRegistrationCheckout;
const supabase_1 = require("./supabase");
async function submitRegistration(input) {
    if (!supabase_1.supabase) {
        return { registrationId: crypto.randomUUID(), registrationToken: crypto.randomUUID(), paymentRequired: true, amountCents: 2500, currency: 'CAD' };
    }
    const { data, error } = await supabase_1.supabase.rpc('submit_public_registration', {
        p_event_id: input.eventId,
        p_email: input.email,
        p_display_name: input.displayName,
        p_team_name: input.teamName,
        p_category: input.category,
        p_phone: input.phone,
        p_emergency_contact: input.emergencyContact,
        p_waiver_acknowledged: input.waiverAcknowledged
    });
    if (error)
        throw error;
    return data;
}
async function uploadWaiver(result, file) {
    if (!supabase_1.supabase)
        return;
    const form = new FormData();
    form.set('registrationId', result.registrationId);
    form.set('registrationToken', result.registrationToken);
    form.set('file', file);
    const { error } = await supabase_1.supabase.functions.invoke('upload-waiver', { body: form });
    if (error)
        throw error;
}
async function createRegistrationCheckout(result) {
    if (!result.paymentRequired)
        return null;
    if (!supabase_1.supabase)
        return 'demo://checkout';
    const { data, error } = await supabase_1.supabase.functions.invoke('create-registration-checkout', { body: { registrationId: result.registrationId, registrationToken: result.registrationToken } });
    if (error)
        throw error;
    return data?.checkoutUrl ?? null;
}

},
"lib/repository": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEventSnapshot = loadEventSnapshot;
const demo_1 = require("../data/demo");
const supabase_1 = require("./supabase");
function snakeMatch(row) {
    return {
        id: row.id,
        organizationId: row.organization_id,
        seasonId: row.season_id,
        eventId: row.event_id,
        fightCardId: row.fight_card_id ?? undefined,
        bracketId: row.bracket_id ?? undefined,
        label: row.label,
        category: row.category,
        matchType: row.match_type,
        scoringConfig: row.scoring_config,
        status: row.status,
        stage: row.stage,
        scheduledOrder: row.scheduled_order,
        bracketRound: row.bracket_round ?? undefined,
        bracketSlot: row.bracket_slot ?? undefined,
        winnerAdvancesToMatchId: row.winner_advances_to_match_id ?? undefined,
        winnerAdvancesToSlot: row.winner_advances_to_slot ?? undefined,
        loserAdvancesToMatchId: row.loser_advances_to_match_id ?? undefined,
        loserAdvancesToSlot: row.loser_advances_to_slot ?? undefined,
        resultSummary: row.result_summary,
        participants: (row.match_participants ?? []).map((p) => ({ rosterEntryId: p.roster_entry_id ?? undefined, sideIndex: p.side_index, seed: p.seed ?? undefined, isPlaceholder: p.is_placeholder, placeholderLabel: p.placeholder_label ?? undefined, sourceMatchId: p.source_match_id ?? undefined, sourceSlot: p.source_slot ?? undefined, isWinnerSource: p.is_winner_source ?? undefined })),
        rounds: (row.match_rounds ?? []).map((r) => ({ roundNumber: r.round_number, side1Score: Number(r.side_1_score), side2Score: Number(r.side_2_score), notes: r.notes ?? undefined }))
    };
}
async function loadEventSnapshot(eventId) {
    if (!supabase_1.supabase) {
        const ghosts = typeof localStorage === 'undefined' ? [] : JSON.parse(localStorage.getItem('buhurtos-demo-ghosts') ?? '[]');
        const savedMatches = typeof localStorage === 'undefined' ? null : localStorage.getItem('buhurtos-demo-matches');
        const bracketMatches = typeof localStorage === 'undefined' ? [] : JSON.parse(localStorage.getItem('buhurtos-demo-bracket-matches') ?? '[]');
        const rosterBase = structuredClone(demo_1.demoRoster);
        const overrides = typeof localStorage === 'undefined' ? {} : JSON.parse(localStorage.getItem('buhurtos-demo-roster-overrides') ?? '{}');
        const roster = [...rosterBase.map(r => ({ ...r, ...(overrides[r.id] ?? {}) })), ...ghosts];
        const baseMatches = savedMatches ? JSON.parse(savedMatches) : structuredClone(demo_1.demoMatches);
        const existingIds = new Set(baseMatches.map((m) => m.id));
        return { event: demo_1.demoEvent, matches: [...baseMatches, ...bracketMatches.filter((m) => !existingIds.has(m.id))], roster, announcements: structuredClone(demo_1.demoAnnouncements) };
    }
    let resolvedEventId = eventId || undefined;
    if (!resolvedEventId) {
        const candidate = await supabase_1.supabase.from('events').select('id').in('status', ['live', 'published', 'draft']).order('starts_at', { ascending: false }).limit(1).maybeSingle();
        if (candidate.error)
            throw candidate.error;
        resolvedEventId = candidate.data?.id;
    }
    if (!resolvedEventId)
        throw new Error('No accessible BuhurtOS event was found. Set VITE_DEFAULT_EVENT_ID or publish an event.');
    const { data: sessionData } = await supabase_1.supabase.auth.getSession();
    const rosterColumns = sessionData.session ? '*' : 'id,event_id,team_id,entry_type,display_name,attendance_status';
    const [eventQuery, rosterQuery, matchQuery, announcementQuery] = await Promise.all([
        supabase_1.supabase.from('events').select('*').eq('id', resolvedEventId).single(),
        supabase_1.supabase.from('event_roster_entries').select(rosterColumns).eq('event_id', resolvedEventId).order('display_name'),
        supabase_1.supabase.from('matches').select('*,match_participants(*),match_rounds(*)').eq('event_id', resolvedEventId).order('scheduled_order'),
        supabase_1.supabase.from('announcements').select('*').eq('event_id', resolvedEventId).order('created_at', { ascending: false })
    ]);
    const error = eventQuery.error || rosterQuery.error || matchQuery.error || announcementQuery.error;
    if (error)
        throw error;
    const e = eventQuery.data;
    return {
        event: {
            id: e.id, organizationId: e.organization_id, seasonId: e.season_id, name: e.name, venue: e.venue,
            startsAt: e.starts_at, endsAt: e.ends_at, organizerName: e.organizer_name ?? undefined,
            eventType: e.event_type, standingsMode: e.standings_mode, status: e.status, timezone: e.timezone, livestreamUrl: e.livestream_url ?? undefined,
            registrationOpen: e.registration_open, registrationFeeCents: e.registration_fee_cents, currency: e.currency
        },
        roster: (rosterQuery.data ?? []).map((r) => ({
            id: r.id, organizationId: r.organization_id, eventId: r.event_id, teamId: r.team_id ?? undefined, fighterId: r.fighter_id ?? undefined,
            entryType: r.entry_type, displayName: r.display_name, checkedIn: r.checked_in ?? false, armorCleared: r.armor_cleared ?? false,
            medicalCleared: r.medical_cleared ?? false, waiverConfirmed: r.waiver_confirmed ?? false, weighInCleared: r.weigh_in_cleared ?? false,
            attendanceStatus: r.attendance_status, metadata: r.metadata
        })),
        matches: (matchQuery.data ?? []).map(snakeMatch),
        announcements: (announcementQuery.data ?? []).map((a) => ({ id: a.id, eventId: a.event_id, title: a.title, body: a.body, isPublic: a.is_public, scheduledFor: a.scheduled_for ?? undefined, createdAt: a.created_at }))
    };
}

},
"lib/resultSubmission": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitMatchResult = submitMatchResult;
const offlineQueue_1 = require("./offlineQueue");
const scoring_1 = require("./scoring");
const supabase_1 = require("./supabase");
async function submitMatchResult(match, rounds, forfeit) {
    const validation = (0, scoring_1.validateScore)(match.scoringConfig, rounds, forfeit);
    if (!validation.valid || !validation.result)
        throw new Error(validation.errors.join(' '));
    if (!navigator.onLine || !supabase_1.supabase) {
        await (0, offlineQueue_1.enqueueMutation)({
            entity: 'match_result',
            entityId: match.id,
            operation: 'rpc',
            payload: { matchId: match.id, rounds, forfeit, expectedStatus: match.status },
            baseVersion: match.status
        });
        return;
    }
    const { error } = await supabase_1.supabase.rpc('submit_match_result', {
        p_match_id: match.id,
        p_rounds: rounds,
        p_forfeit_side: forfeit?.side ?? null,
        p_forfeit_reason: forfeit?.reason ?? null,
        p_expected_status: match.status
    });
    if (error)
        throw error;
}

}
};
