export const modules8={
"pages/DisciplinePage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DisciplinePage = DisciplinePage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const AppState_1 = require("../features/AppState");
const supabase_1 = require("../lib/supabase");
const DEMO_KEY = 'buhurtos-demo-discipline';
const demoSeed = [{ id: 'dc-1', eventId: 'event-hacsa-demo', seasonId: 'season-2026', rosterEntryId: 'r3', color: 'yellow', reason: 'Unsafe strike warning', notes: 'First warning', issuedAt: '2026-09-20T16:40:00.000Z' }];
function DisciplinePage() {
    const { event, roster, user } = (0, AppState_1.useAppState)();
    const [cards, setCards] = (0, react_1.useState)([]);
    const [form, setForm] = (0, react_1.useState)({ rosterEntryId: '', color: 'yellow', reason: '', notes: '' });
    const [message, setMessage] = (0, react_1.useState)('');
    (0, react_1.useEffect)(() => {
        if (!event)
            return;
        if (!supabase_1.supabase) {
            const stored = localStorage.getItem(DEMO_KEY);
            setCards(stored ? JSON.parse(stored) : demoSeed);
            return;
        }
        supabase_1.supabase.from('disciplinary_cards').select('*').eq('season_id', event.seasonId).order('issued_at', { ascending: false }).then(({ data, error }) => {
            if (error)
                return setMessage(error.message);
            setCards((data ?? []).map((c) => ({ id: c.id, eventId: c.event_id, seasonId: c.season_id, matchId: c.match_id ?? undefined, fighterId: c.fighter_id ?? undefined, rosterEntryId: c.roster_entry_id ?? undefined, color: c.color, reason: c.card_reason, notes: c.notes ?? undefined, issuedAt: c.issued_at })));
        });
    }, [event?.id]);
    if (!event)
        return null;
    const save = async () => {
        if (!form.rosterEntryId || !form.reason.trim())
            return;
        const entry = roster.find(r => r.id === form.rosterEntryId);
        const card = { id: crypto.randomUUID(), eventId: event.id, seasonId: event.seasonId, rosterEntryId: entry?.id, fighterId: entry?.fighterId, color: form.color, reason: form.reason.trim(), notes: form.notes.trim() || undefined, issuedAt: new Date().toISOString() };
        if (!supabase_1.supabase) {
            const next = [card, ...cards];
            setCards(next);
            localStorage.setItem(DEMO_KEY, JSON.stringify(next));
        }
        else {
            const { error } = await supabase_1.supabase.from('disciplinary_cards').insert({ organization_id: event.organizationId, season_id: event.seasonId, event_id: event.id, roster_entry_id: card.rosterEntryId, fighter_id: card.fighterId ?? null, color: card.color, card_reason: card.reason, notes: card.notes ?? null, issued_by: user?.userId ?? null });
            if (error)
                return setMessage(error.message);
            setCards([card, ...cards]);
        }
        setForm({ rosterEntryId: '', color: 'yellow', reason: '', notes: '' });
        setMessage('Card recorded in the season history.');
    };
    const name = (id) => roster.find(r => r.id === id)?.displayName ?? 'Unknown fighter';
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("section", { className: "section-head", children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Season discipline" }), (0, jsx_runtime_1.jsx)("h1", { children: "Cards & Warnings" }), (0, jsx_runtime_1.jsx)("p", { children: "Cards stay tied to both the event and season so repeat issues can be reviewed across events." })] }) }), (0, jsx_runtime_1.jsxs)("div", { className: "admin-grid", children: [(0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Issue card" }), (0, jsx_runtime_1.jsxs)("div", { className: "form-stack", children: [(0, jsx_runtime_1.jsxs)("label", { children: ["Competitor", (0, jsx_runtime_1.jsxs)("select", { value: form.rosterEntryId, onChange: e => setForm(f => ({ ...f, rosterEntryId: e.target.value })), children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "Choose competitor" }), roster.filter(r => r.fighterId).map(r => (0, jsx_runtime_1.jsx)("option", { value: r.id, children: r.displayName }, r.id))] })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Card", (0, jsx_runtime_1.jsxs)("select", { value: form.color, onChange: e => setForm(f => ({ ...f, color: e.target.value })), children: [(0, jsx_runtime_1.jsx)("option", { value: "yellow", children: "Yellow" }), (0, jsx_runtime_1.jsx)("option", { value: "red", children: "Red" })] })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Reason", (0, jsx_runtime_1.jsx)("input", { value: form.reason, onChange: e => setForm(f => ({ ...f, reason: e.target.value })) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Notes", (0, jsx_runtime_1.jsx)("textarea", { value: form.notes, onChange: e => setForm(f => ({ ...f, notes: e.target.value })) })] }), (0, jsx_runtime_1.jsx)("button", { className: "primary big", onClick: save, children: "Record Card" })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Season history" }), (0, jsx_runtime_1.jsx)("div", { className: "discipline-list", children: cards.map(card => (0, jsx_runtime_1.jsxs)("article", { children: [(0, jsx_runtime_1.jsx)("span", { className: `card-dot ${card.color}` }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("b", { children: name(card.rosterEntryId) }), (0, jsx_runtime_1.jsx)("p", { children: card.reason }), (0, jsx_runtime_1.jsx)("small", { children: new Date(card.issuedAt).toLocaleString() })] })] }, card.id)) })] })] }), message && (0, jsx_runtime_1.jsx)("div", { className: "auth-message", children: message })] });
}

},
"pages/LoginPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginPage = LoginPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const react_router_dom_1 = require("react-router-dom");
const AppState_1 = require("../features/AppState");
const auth_1 = require("../lib/auth");
function LoginPage() {
    const { user } = (0, AppState_1.useAppState)();
    const location = (0, react_router_dom_1.useLocation)();
    const [email, setEmail] = (0, react_1.useState)('');
    const [password, setPassword] = (0, react_1.useState)('');
    const [message, setMessage] = (0, react_1.useState)('');
    const [busy, setBusy] = (0, react_1.useState)(false);
    if (user)
        return (0, jsx_runtime_1.jsx)(react_router_dom_1.Navigate, { to: `/${location.search}`, replace: true });
    const run = async (action) => {
        setBusy(true);
        setMessage('');
        try {
            if (action === 'password')
                await (0, auth_1.signIn)(email, password);
            else
                await (0, auth_1.sendMagicLink)(email);
            setMessage(action === 'magic' ? 'Magic link sent. Check your email.' : 'Signed in.');
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : 'Sign in failed.');
        }
        finally {
            setBusy(false);
        }
    };
    return (0, jsx_runtime_1.jsx)("main", { className: "auth-shell", children: (0, jsx_runtime_1.jsxs)("section", { className: "auth-card", children: [(0, jsx_runtime_1.jsx)("span", { className: "brand-mark large", children: "B" }), (0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "BuhurtOS" }), (0, jsx_runtime_1.jsx)("h1", { children: "Field Sign In" }), (0, jsx_runtime_1.jsx)("p", { children: "Use your tournament account. Public event pages never require a login." }), (0, jsx_runtime_1.jsxs)("label", { children: ["Email", (0, jsx_runtime_1.jsx)("input", { type: "email", autoComplete: "email", value: email, onChange: e => setEmail(e.target.value) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Password", (0, jsx_runtime_1.jsx)("input", { type: "password", autoComplete: "current-password", value: password, onChange: e => setPassword(e.target.value) })] }), message && (0, jsx_runtime_1.jsx)("div", { className: "auth-message", children: message }), (0, jsx_runtime_1.jsx)("button", { className: "primary big", disabled: busy || !email || !password, onClick: () => run('password'), children: "Sign In" }), (0, jsx_runtime_1.jsx)("button", { className: "big", disabled: busy || !email, onClick: () => run('magic'), children: "Email Magic Link" })] }) });
}

},
"pages/NotesPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotesPage = NotesPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const AppState_1 = require("../features/AppState");
const supabase_1 = require("../lib/supabase");
const KEY = 'buhurtos-demo-notes';
function NotesPage() {
    const { event, matches, roster, user } = (0, AppState_1.useAppState)();
    const [notes, setNotes] = (0, react_1.useState)([]);
    const [matchId, setMatchId] = (0, react_1.useState)('');
    const [teamId, setTeamId] = (0, react_1.useState)('');
    const [visibility, setVisibility] = (0, react_1.useState)('private');
    const [body, setBody] = (0, react_1.useState)('');
    const [message, setMessage] = (0, react_1.useState)('');
    const captainTeam = event ? user?.eventRoles.find(role => role.eventId === event.id && role.role === 'team_captain')?.teamId : undefined;
    const teamOptions = (0, react_1.useMemo)(() => {
        const ids = [...new Set(roster.map(entry => entry.teamId).filter((id) => Boolean(id)))];
        return ids.map(id => ({ id, label: roster.filter(entry => entry.teamId === id).slice(0, 2).map(entry => entry.displayName).join(', ') || `Team ${id.slice(0, 8)}` }));
    }, [roster]);
    (0, react_1.useEffect)(() => {
        if (!event)
            return;
        if (!supabase_1.supabase) {
            const s = localStorage.getItem(KEY);
            setNotes(s ? JSON.parse(s) : []);
            return;
        }
        supabase_1.supabase.from('fight_notes').select('*').eq('event_id', event.id).order('created_at', { ascending: false }).then(({ data, error }) => {
            if (error)
                setMessage(error.message);
            else
                setNotes((data ?? []).map((n) => ({ id: n.id, matchId: n.match_id, teamId: n.team_id ?? undefined, visibility: n.visibility, body: n.note_body, createdAt: n.created_at })));
        });
    }, [event?.id]);
    (0, react_1.useEffect)(() => {
        if (visibility === 'team_only' && !teamId && captainTeam)
            setTeamId(captainTeam);
    }, [visibility, teamId, captainTeam]);
    if (!event)
        return null;
    const save = async () => {
        if (!matchId || !body.trim() || !user)
            return;
        if (visibility === 'team_only' && !teamId)
            return setMessage('Choose the team this note belongs to.');
        const note = { id: crypto.randomUUID(), matchId, teamId: visibility === 'team_only' ? teamId : undefined, visibility, body: body.trim(), createdAt: new Date().toISOString() };
        if (!supabase_1.supabase) {
            const next = [note, ...notes];
            setNotes(next);
            localStorage.setItem(KEY, JSON.stringify(next));
        }
        else {
            const { error } = await supabase_1.supabase.from('fight_notes').insert({ event_id: event.id, match_id: matchId, author_user_id: user.userId, team_id: note.teamId ?? null, visibility, note_body: body.trim() });
            if (error)
                return setMessage(error.message);
            setNotes([note, ...notes]);
        }
        setBody('');
        setMessage('Note saved with its visibility rule.');
    };
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("section", { className: "section-head", children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Captain and marshal records" }), (0, jsx_runtime_1.jsx)("h1", { children: "Fight Notes" }), (0, jsx_runtime_1.jsx)("p", { children: "Private, team-only, and marshal-visible notes remain separated by team-scoped RLS." })] }) }), (0, jsx_runtime_1.jsxs)("div", { className: "admin-grid", children: [(0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "New note" }), (0, jsx_runtime_1.jsxs)("div", { className: "form-stack", children: [(0, jsx_runtime_1.jsxs)("label", { children: ["Match", (0, jsx_runtime_1.jsxs)("select", { value: matchId, onChange: e => setMatchId(e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "Choose match" }), matches.map(m => (0, jsx_runtime_1.jsx)("option", { value: m.id, children: m.label }, m.id))] })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Visibility", (0, jsx_runtime_1.jsxs)("select", { value: visibility, onChange: e => setVisibility(e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "private", children: "Private" }), (0, jsx_runtime_1.jsx)("option", { value: "team_only", children: "Team only" }), (0, jsx_runtime_1.jsx)("option", { value: "marshal_visible", children: "Marshal visible" })] })] }), visibility === 'team_only' && (0, jsx_runtime_1.jsxs)("label", { children: ["Team", (0, jsx_runtime_1.jsxs)("select", { value: teamId, disabled: Boolean(captainTeam), onChange: e => setTeamId(e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "Choose team" }), teamOptions.map(team => (0, jsx_runtime_1.jsx)("option", { value: team.id, children: team.label }, team.id))] })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Note", (0, jsx_runtime_1.jsx)("textarea", { value: body, onChange: e => setBody(e.target.value), placeholder: "Tactical or operational note" })] }), (0, jsx_runtime_1.jsx)("button", { className: "primary big", onClick: save, children: "Save Note" })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Visible notes" }), (0, jsx_runtime_1.jsx)("div", { className: "announcement-list", children: notes.map(n => (0, jsx_runtime_1.jsxs)("article", { children: [(0, jsx_runtime_1.jsxs)("b", { children: [matches.find(m => m.id === n.matchId)?.label ?? 'Match', " • ", n.visibility.replaceAll('_', ' ')] }), (0, jsx_runtime_1.jsx)("p", { children: n.body }), (0, jsx_runtime_1.jsx)("small", { children: new Date(n.createdAt).toLocaleString() })] }, n.id)) })] })] }), message && (0, jsx_runtime_1.jsx)("div", { className: "auth-message", children: message })] });
}

}
};
