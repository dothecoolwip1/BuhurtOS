export const modules7={
"pages/AdminPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminPage = AdminPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const AppState_1 = require("../features/AppState");
const compliance_1 = require("../lib/compliance");
const bracket_1 = require("../lib/bracket");
const adminActions_1 = require("../lib/adminActions");
const memberAdmin_1 = require("../lib/memberAdmin");
const assignableRoles = [
    { value: 'event_organizer', label: 'Event Organizer' },
    { value: 'field_marshal', label: 'Field Marshal' },
    { value: 'assistant_marshal', label: 'Assistant Marshal' },
    { value: 'team_captain', label: 'Team Captain' },
    { value: 'fighter', label: 'Fighter' }
];
function AdminPage() {
    const { event, roster, reload } = (0, AppState_1.useAppState)();
    const [ghostName, setGhostName] = (0, react_1.useState)('');
    const [selected, setSelected] = (0, react_1.useState)([]);
    const [message, setMessage] = (0, react_1.useState)('');
    const [busy, setBusy] = (0, react_1.useState)(false);
    const [memberships, setMemberships] = (0, react_1.useState)([]);
    const [memberForm, setMemberForm] = (0, react_1.useState)({ email: '', displayName: '', role: 'field_marshal', teamId: '' });
    const eligible = (0, react_1.useMemo)(() => roster.filter(r => (0, compliance_1.checkCompliance)(r).eligible), [roster]);
    const teamOptions = (0, react_1.useMemo)(() => [...new Set(roster.map(entry => entry.teamId).filter((id) => Boolean(id)))].map(id => ({ id, label: roster.filter(entry => entry.teamId === id).slice(0, 2).map(entry => entry.displayName).join(', ') || `Team ${id.slice(0, 8)}` })), [roster]);
    const loadMembers = async () => {
        if (!event)
            return;
        try {
            setMemberships(await (0, memberAdmin_1.listEventMemberships)(event.id));
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Unable to load event access.');
        }
    };
    (0, react_1.useEffect)(() => { loadMembers(); }, [event?.id]);
    if (!event)
        return null;
    const addGhost = async () => {
        if (!ghostName.trim())
            return;
        setBusy(true);
        setMessage('');
        try {
            await (0, adminActions_1.addGhostFighter)(event, ghostName.trim());
            setGhostName('');
            await reload();
            setMessage('Ghost fighter added. Complete compliance before bracket placement.');
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : 'Unable to add ghost fighter.');
        }
        finally {
            setBusy(false);
        }
    };
    const generate = async () => {
        const chosen = eligible.filter(r => selected.includes(r.id));
        if (chosen.length < 2)
            return setMessage('Choose at least two cleared competitors.');
        setBusy(true);
        setMessage('');
        try {
            const bracketId = crypto.randomUUID();
            const plan = (0, bracket_1.generateSingleElimination)({ organizationId: event.organizationId, seasonId: event.seasonId, eventId: event.id, bracketId, category: 'Duel', matchType: 'longsword', entries: chosen.map((entry, index) => ({ entry, seed: index + 1 })), scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false, scoreCapPerRound: 10 } });
            await (0, adminActions_1.saveBracketPlan)(event, plan, { id: bracketId, name: `Duel Bracket ${new Date().toLocaleDateString()}`, category: 'Duel' });
            await reload();
            setMessage(`Bracket created with ${plan.matches.length} matches. Same-team separation and automatic byes were applied.`);
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : 'Unable to create bracket.');
        }
        finally {
            setBusy(false);
        }
    };
    const addMember = async () => {
        if (!memberForm.email.trim())
            return;
        if (memberForm.role === 'team_captain' && !memberForm.teamId)
            return setMessage('Choose a team for the captain.');
        setBusy(true);
        setMessage('');
        try {
            const result = await (0, memberAdmin_1.inviteEventMember)({ eventId: event.id, email: memberForm.email.trim(), displayName: memberForm.displayName.trim() || undefined, role: memberForm.role, teamId: memberForm.role === 'team_captain' ? memberForm.teamId : undefined });
            await loadMembers();
            setMemberForm({ email: '', displayName: '', role: 'field_marshal', teamId: '' });
            setMessage(result.invited ? 'Invitation sent and event access assigned.' : 'Existing account found and event access assigned.');
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : 'Unable to assign event access.');
        }
        finally {
            setBusy(false);
        }
    };
    const removeMember = async (id) => {
        setBusy(true);
        setMessage('');
        try {
            await (0, memberAdmin_1.removeEventMembership)(id);
            await loadMembers();
            setMessage('Event role removed.');
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : 'Unable to remove event role.');
        }
        finally {
            setBusy(false);
        }
    };
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("section", { className: "section-head", children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Event setup" }), (0, jsx_runtime_1.jsx)("h1", { children: "Organizer Tools" }), (0, jsx_runtime_1.jsx)("p", { children: "Administrative actions are kept separate from live field controls." })] }) }), (0, jsx_runtime_1.jsxs)("div", { className: "admin-grid", children: [(0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Add ghost fighter" }), (0, jsx_runtime_1.jsx)("p", { children: "Create an event-only identity immediately. It can later be linked to a permanent fighter without changing historical match references." }), (0, jsx_runtime_1.jsxs)("div", { className: "inline-form", children: [(0, jsx_runtime_1.jsx)("input", { value: ghostName, onChange: e => setGhostName(e.target.value), placeholder: "Display name" }), (0, jsx_runtime_1.jsx)("button", { className: "primary", disabled: busy, onClick: addGhost, children: "Add" })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Generate single-elimination bracket" }), (0, jsx_runtime_1.jsx)("p", { children: "Only cleared competitors are selectable. Standard seeding preserves byes while anti-fratricide optimization separates same-team fighters where possible." }), (0, jsx_runtime_1.jsx)("div", { className: "selector-list", children: eligible.map(entry => (0, jsx_runtime_1.jsxs)("label", { children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: selected.includes(entry.id), onChange: e => setSelected(current => e.target.checked ? [...current, entry.id] : current.filter(id => id !== entry.id)) }), (0, jsx_runtime_1.jsx)("span", { children: entry.displayName })] }, entry.id)) }), (0, jsx_runtime_1.jsx)("button", { className: "primary big", disabled: busy || selected.length < 2, onClick: generate, children: "Generate Bracket" })] }), (0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Invite event member" }), (0, jsx_runtime_1.jsx)("p", { children: "Invitations are handled server-side. Service credentials never enter the browser." }), (0, jsx_runtime_1.jsxs)("div", { className: "form-stack", children: [(0, jsx_runtime_1.jsxs)("label", { children: ["Email", (0, jsx_runtime_1.jsx)("input", { type: "email", value: memberForm.email, onChange: e => setMemberForm(f => ({ ...f, email: e.target.value })) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Display name", (0, jsx_runtime_1.jsx)("input", { value: memberForm.displayName, onChange: e => setMemberForm(f => ({ ...f, displayName: e.target.value })) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Role", (0, jsx_runtime_1.jsx)("select", { value: memberForm.role, onChange: e => setMemberForm(f => ({ ...f, role: e.target.value, teamId: e.target.value === 'team_captain' ? f.teamId : '' })), children: assignableRoles.map(role => (0, jsx_runtime_1.jsx)("option", { value: role.value, children: role.label }, role.value)) })] }), memberForm.role === 'team_captain' && (0, jsx_runtime_1.jsxs)("label", { children: ["Captain team", (0, jsx_runtime_1.jsxs)("select", { value: memberForm.teamId, onChange: e => setMemberForm(f => ({ ...f, teamId: e.target.value })), children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "Choose team" }), teamOptions.map(team => (0, jsx_runtime_1.jsx)("option", { value: team.id, children: team.label }, team.id))] })] }), (0, jsx_runtime_1.jsx)("button", { className: "primary big", disabled: busy || !memberForm.email, onClick: addMember, children: "Invite / Assign Access" })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Event access" }), (0, jsx_runtime_1.jsx)("p", { children: "Removing a role only removes access for this event. It does not delete the account or fighter history." }), (0, jsx_runtime_1.jsx)("div", { className: "membership-list", children: memberships.length === 0 ? (0, jsx_runtime_1.jsx)("div", { className: "state-card", children: "No managed event roles are visible yet." }) : memberships.map(member => (0, jsx_runtime_1.jsxs)("article", { children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: member.displayName }), (0, jsx_runtime_1.jsxs)("small", { children: [member.role.replaceAll('_', ' '), member.teamId ? ` · team ${member.teamId.slice(0, 8)}` : ''] })] }), (0, jsx_runtime_1.jsx)("button", { disabled: busy, onClick: () => removeMember(member.id), children: "Remove" })] }, member.id)) })] })] }), message && (0, jsx_runtime_1.jsx)("div", { className: "auth-message", children: message })] });
}

},
"pages/BracketPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BracketPage = BracketPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const AppState_1 = require("../features/AppState");
const bracketView_1 = require("../lib/bracketView");
function BracketPage() {
    const { matches, roster } = (0, AppState_1.useAppState)();
    const rounds = (0, bracketView_1.groupBracketRounds)(matches);
    const name = (id, placeholder) => roster.find(r => r.id === id)?.displayName ?? placeholder ?? 'TBD';
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("section", { className: "section-head", children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Bracket" }), (0, jsx_runtime_1.jsx)("h1", { children: "Live Progression" }), (0, jsx_runtime_1.jsx)("p", { children: "Winner links are relational, so completed results advance without rewriting bracket history." })] }) }), (0, jsx_runtime_1.jsx)("div", { className: "bracket-scroll", children: (0, jsx_runtime_1.jsx)("div", { className: "bracket-grid", children: rounds.map(group => (0, jsx_runtime_1.jsxs)("section", { className: "bracket-round", children: [(0, jsx_runtime_1.jsx)("h2", { children: group.round === rounds.length ? 'Final' : `Round ${group.round}` }), group.matches.map(match => (0, jsx_runtime_1.jsxs)("article", { className: "bracket-match", children: [(0, jsx_runtime_1.jsx)("span", { children: match.label }), [1, 2].map(side => { const p = match.participants.find(x => x.sideIndex === side); return (0, jsx_runtime_1.jsxs)("div", { className: match.resultSummary?.winnerSide === side ? 'winner' : '', children: [(0, jsx_runtime_1.jsx)("b", { children: name(p?.rosterEntryId, p?.placeholderLabel) }), match.resultSummary && (0, jsx_runtime_1.jsx)("strong", { children: side === 1 ? match.resultSummary.side1Total : match.resultSummary.side2Total })] }, side); })] }, match.id))] }, group.round)) }) })] });
}

}
};
