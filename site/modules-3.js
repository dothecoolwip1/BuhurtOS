export const modules3={
"features/AppState": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppStateProvider = AppStateProvider;
exports.useAppState = useAppState;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const demo_1 = require("../data/demo");
const repository_1 = require("../lib/repository");
const supabase_1 = require("../lib/supabase");
const scoring_1 = require("../lib/scoring");
const bracket_1 = require("../lib/bracket");
const offlineQueue_1 = require("../lib/offlineQueue");
const userContext_1 = require("../lib/userContext");
const AppStateContext = (0, react_1.createContext)(null);
function AppStateProvider({ children }) {
    const [loading, setLoading] = (0, react_1.useState)(true);
    const [error, setError] = (0, react_1.useState)(null);
    const [event, setEvent] = (0, react_1.useState)(null);
    const [matches, setMatches] = (0, react_1.useState)([]);
    const [roster, setRoster] = (0, react_1.useState)([]);
    const [announcements, setAnnouncements] = (0, react_1.useState)([]);
    const [user, setUser] = (0, react_1.useState)(supabase_1.isSupabaseConfigured ? null : demo_1.demoUser);
    const [online, setOnline] = (0, react_1.useState)(typeof navigator === 'undefined' ? true : navigator.onLine);
    const [pendingCount, setPendingCount] = (0, react_1.useState)(0);
    const refreshPending = (0, react_1.useCallback)(async () => setPendingCount((await (0, offlineQueue_1.listMutations)()).length), []);
    const reload = (0, react_1.useCallback)(async () => {
        try {
            setError(null);
            const requestedEventId = typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search).get('event') ?? undefined;
            const snap = await (0, repository_1.loadEventSnapshot)(requestedEventId);
            setEvent(snap.event);
            setMatches(snap.matches);
            setRoster(snap.roster);
            setAnnouncements(snap.announcements);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to load event data.');
        }
        finally {
            setLoading(false);
        }
    }, []);
    (0, react_1.useEffect)(() => {
        reload();
        refreshPending();
    }, [reload, refreshPending]);
    (0, react_1.useEffect)(() => {
        if (!supabase_1.supabase)
            return;
        supabase_1.supabase.auth.getUser().then(async ({ data }) => {
            if (!data.user)
                return setUser(null);
            setUser(await (0, userContext_1.loadUserContext)(data.user.id, data.user.email ?? 'Signed in user'));
        }).catch(() => setUser(null));
        const { data } = supabase_1.supabase.auth.onAuthStateChange((_event, session) => {
            if (!session?.user)
                setUser(null);
            else
                (0, userContext_1.loadUserContext)(session.user.id, session.user.email ?? 'Signed in user').then(setUser).catch(() => setUser(null));
        });
        return () => data.subscription.unsubscribe();
    }, []);
    (0, react_1.useEffect)(() => {
        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
    }, []);
    (0, react_1.useEffect)(() => {
        if (!event || !supabase_1.supabase)
            return;
        const channel = (0, supabase_1.subscribeToEvent)(event.id, reload);
        return () => { if (channel)
            supabase_1.supabase.removeChannel(channel); };
    }, [event?.id, reload]);
    const updateCompliance = (0, react_1.useCallback)(async (entryId, field, value) => {
        const before = roster.find(r => r.id === entryId);
        if (!before)
            return;
        setRoster(current => current.map(r => r.id === entryId ? { ...r, [field]: value } : r));
        if (!supabase_1.supabase) {
            const overrides = JSON.parse(localStorage.getItem('buhurtos-demo-roster-overrides') ?? '{}');
            overrides[entryId] = { ...(overrides[entryId] ?? {}), [field]: value };
            localStorage.setItem('buhurtos-demo-roster-overrides', JSON.stringify(overrides));
            return;
        }
        if (!online) {
            await (0, offlineQueue_1.enqueueMutation)({ entity: 'event_roster_entries', entityId: entryId, operation: 'update', payload: { [field]: value }, baseVersion: JSON.stringify(before) });
            await refreshPending();
            return;
        }
        const column = { checkedIn: 'checked_in', armorCleared: 'armor_cleared', medicalCleared: 'medical_cleared', waiverConfirmed: 'waiver_confirmed', weighInCleared: 'weigh_in_cleared' }[field];
        const { error: writeError } = await supabase_1.supabase.from('event_roster_entries').update({ [column]: value }).eq('id', entryId);
        if (writeError) {
            setRoster(current => current.map(r => r.id === entryId ? before : r));
            throw writeError;
        }
    }, [roster, online, refreshPending]);
    const finalizeResult = (0, react_1.useCallback)(async (matchId, rounds, forfeit) => {
        const match = matches.find(m => m.id === matchId);
        if (!match)
            throw new Error('Match not found.');
        const validation = (0, scoring_1.validateScore)(match.scoringConfig, rounds, forfeit);
        if (!validation.valid || !validation.result)
            throw new Error(validation.errors.join(' '));
        if (supabase_1.supabase && online) {
            const { error: rpcError } = await supabase_1.supabase.rpc('submit_match_result', {
                p_match_id: match.id,
                p_rounds: rounds,
                p_forfeit_side: forfeit?.side ?? null,
                p_forfeit_reason: forfeit?.reason ?? null,
                p_expected_status: match.status
            });
            if (rpcError)
                throw rpcError;
            await reload();
            return;
        }
        let next = matches.map(m => m.id === matchId ? { ...m, rounds, resultSummary: validation.result, status: 'finalized' } : m);
        const winnerSide = validation.result.winnerSide;
        if (winnerSide) {
            const winnerId = match.participants.find(p => p.sideIndex === winnerSide)?.rosterEntryId;
            if (winnerId)
                next = (0, bracket_1.advanceWinner)(next, matchId, winnerId);
        }
        setMatches(next);
        if (!supabase_1.supabase) {
            localStorage.setItem('buhurtos-demo-matches', JSON.stringify(next));
            return;
        }
        if (!online) {
            await (0, offlineQueue_1.enqueueMutation)({ entity: 'match_result', entityId: match.id, operation: 'rpc', payload: { rounds, forfeit }, baseVersion: match.status });
            await refreshPending();
        }
    }, [matches, online, reload, refreshPending]);
    const reorderMatch = (0, react_1.useCallback)(async (matchId, direction) => {
        const ordered = [...matches].sort((a, b) => a.scheduledOrder - b.scheduledOrder);
        const index = ordered.findIndex(m => m.id === matchId);
        const swapIndex = index + direction;
        if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length)
            return;
        [ordered[index].scheduledOrder, ordered[swapIndex].scheduledOrder] = [ordered[swapIndex].scheduledOrder, ordered[index].scheduledOrder];
        const reordered = [...ordered].sort((a, b) => a.scheduledOrder - b.scheduledOrder);
        setMatches(reordered);
        if (!supabase_1.supabase) {
            localStorage.setItem('buhurtos-demo-matches', JSON.stringify(reordered));
            return;
        }
        if (!online) {
            await (0, offlineQueue_1.enqueueMutation)({ entity: 'fight_card_order', entityId: matchId, operation: 'rpc', payload: { direction } });
            await refreshPending();
            return;
        }
        const { error: rpcError } = await supabase_1.supabase.rpc('reorder_match', { p_match_id: matchId, p_direction: direction });
        if (rpcError)
            throw rpcError;
    }, [matches, online, refreshPending]);
    const setMatchStatus = (0, react_1.useCallback)(async (matchId, status) => {
        const match = matches.find(m => m.id === matchId);
        if (!match || match.status === status)
            return;
        const previous = match.status;
        const exclusive = new Set(['active', 'on_deck', 'in_the_hole']);
        const nextMatches = matches.map(m => {
            if (m.id === matchId)
                return { ...m, status };
            if (exclusive.has(status) && m.eventId === match.eventId && m.fightCardId === match.fightCardId && m.status === status)
                return { ...m, status: 'scheduled' };
            return m;
        });
        setMatches(nextMatches);
        if (!supabase_1.supabase) {
            localStorage.setItem('buhurtos-demo-matches', JSON.stringify(nextMatches));
            return;
        }
        if (!online) {
            await (0, offlineQueue_1.enqueueMutation)({ entity: 'match_status', entityId: match.id, operation: 'rpc', payload: { status }, baseVersion: previous });
            await refreshPending();
            return;
        }
        const { error: rpcError } = await supabase_1.supabase.rpc('set_match_status', { p_match_id: match.id, p_status: status, p_expected_status: previous });
        if (rpcError) {
            setMatches(matches);
            throw rpcError;
        }
        await reload();
    }, [matches, online, refreshPending, reload]);
    const syncNow = (0, react_1.useCallback)(async () => {
        if (!supabase_1.supabase || !online)
            return;
        await (0, offlineQueue_1.flushMutationQueue)(async (mutation) => {
            if (mutation.operation === 'rpc' && mutation.entity === 'match_result') {
                const payload = mutation.payload;
                const { error: e } = await supabase_1.supabase.rpc('submit_match_result', { p_match_id: mutation.entityId, p_rounds: payload.rounds, p_forfeit_side: payload.forfeit?.side ?? null, p_forfeit_reason: payload.forfeit?.reason ?? null, p_expected_status: mutation.baseVersion ?? 'scheduled' });
                if (e)
                    return { ok: false, conflict: e.code === 'P0001' || e.code === '40001', error: e.message };
                return { ok: true };
            }
            if (mutation.operation === 'rpc' && mutation.entity === 'match_status') {
                const payload = mutation.payload;
                const { error: e } = await supabase_1.supabase.rpc('set_match_status', { p_match_id: mutation.entityId, p_status: payload.status, p_expected_status: mutation.baseVersion ?? 'scheduled' });
                if (e)
                    return { ok: false, conflict: e.code === 'P0001' || /changed since/i.test(e.message), error: e.message };
                return { ok: true };
            }
            if (mutation.operation === 'rpc' && mutation.entity === 'fight_card_order') {
                const payload = mutation.payload;
                const { error: e } = await supabase_1.supabase.rpc('reorder_match', { p_match_id: mutation.entityId, p_direction: payload.direction });
                return e ? { ok: false, error: e.message } : { ok: true };
            }
            if (mutation.operation === 'update' && mutation.entity === 'event_roster_entries') {
                const payload = mutation.payload;
                const mapped = {};
                const map = { checkedIn: 'checked_in', armorCleared: 'armor_cleared', medicalCleared: 'medical_cleared', waiverConfirmed: 'waiver_confirmed', weighInCleared: 'weigh_in_cleared' };
                const base = mutation.baseVersion ? JSON.parse(mutation.baseVersion) : null;
                const { data: current, error: readError } = await supabase_1.supabase.from('event_roster_entries').select('checked_in,armor_cleared,medical_cleared,waiver_confirmed,weigh_in_cleared').eq('id', mutation.entityId).single();
                if (readError)
                    return { ok: false, error: readError.message };
                for (const [key, value] of Object.entries(payload)) {
                    const column = map[key] ?? key;
                    mapped[column] = value;
                    if (base) {
                        const before = base[key];
                        const remote = current[column];
                        if (remote !== before && remote !== value)
                            return { ok: false, conflict: true, error: `Roster field ${key} changed on another device.` };
                    }
                }
                const { error: e } = await supabase_1.supabase.from('event_roster_entries').update(mapped).eq('id', mutation.entityId);
                return e ? { ok: false, error: e.message } : { ok: true };
            }
            return { ok: false, error: 'Unsupported queued mutation type.' };
        });
        await refreshPending();
        await reload();
    }, [online, refreshPending, reload]);
    (0, react_1.useEffect)(() => {
        if (!online || pendingCount === 0 || !supabase_1.supabase)
            return;
        const timer = window.setTimeout(() => { syncNow().catch(err => setError(err instanceof Error ? err.message : 'Background sync failed.')); }, 350);
        return () => window.clearTimeout(timer);
    }, [online, pendingCount, syncNow]);
    (0, react_1.useEffect)(() => {
        if (!('serviceWorker' in navigator))
            return;
        const handler = (event) => {
            if (event.data?.type === 'BuhurtOS_SYNC_REQUEST')
                syncNow().catch(() => undefined);
        };
        navigator.serviceWorker.addEventListener('message', handler);
        return () => navigator.serviceWorker.removeEventListener('message', handler);
    }, [syncNow]);
    const value = (0, react_1.useMemo)(() => ({ loading, error, event, matches, roster, announcements, user, online, pendingCount, dataMode: supabase_1.isSupabaseConfigured ? 'supabase' : 'demo', reload, updateCompliance, finalizeResult, reorderMatch, setMatchStatus, syncNow, refreshQueue: refreshPending }), [loading, error, event, matches, roster, announcements, user, online, pendingCount, reload, updateCompliance, finalizeResult, reorderMatch, setMatchStatus, syncNow, refreshPending]);
    return (0, jsx_runtime_1.jsx)(AppStateContext.Provider, { value: value, children: children });
}
function useAppState() {
    const ctx = (0, react_1.useContext)(AppStateContext);
    if (!ctx)
        throw new Error('useAppState must be used inside AppStateProvider.');
    return ctx;
}

}
};
