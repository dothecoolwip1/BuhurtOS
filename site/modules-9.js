export const modules9={
"pages/OpsPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpsPage = OpsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const MatchCard_1 = require("../components/MatchCard");
const ScoreDialog_1 = require("../components/ScoreDialog");
const AppState_1 = require("../features/AppState");
const permissions_1 = require("../lib/permissions");
function OpsPage() {
    const { loading, error, matches, roster, finalizeResult, reorderMatch, setMatchStatus, user, event } = (0, AppState_1.useAppState)();
    const [scoring, setScoring] = (0, react_1.useState)(null);
    const canScore = Boolean(event && (0, permissions_1.hasPermission)(user, 'match.score', event.id, event.organizationId));
    const canReorder = Boolean(event && (0, permissions_1.hasPermission)(user, 'match.manage', event.id, event.organizationId));
    const ordered = (0, react_1.useMemo)(() => [...matches].sort((a, b) => a.scheduledOrder - b.scheduledOrder), [matches]);
    const active = ordered.find(m => m.status === 'active');
    const onDeck = ordered.find(m => m.status === 'on_deck');
    const inHole = ordered.find(m => m.status === 'in_the_hole');
    if (loading)
        return (0, jsx_runtime_1.jsx)("div", { className: "state-card", children: "Loading tournament operations…" });
    if (error)
        return (0, jsx_runtime_1.jsx)("div", { className: "state-card error", children: error });
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("section", { className: "hero-grid", children: [(0, jsx_runtime_1.jsxs)("div", { className: "hero-card", children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Field status" }), (0, jsx_runtime_1.jsx)("h1", { children: "Marshal Console" }), (0, jsx_runtime_1.jsx)("p", { children: "Fast field controls with oversized targets, explicit states, and no drag controls for critical ordering." })] }), (0, jsx_runtime_1.jsxs)("div", { className: "bullpen", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: "NOW" }), (0, jsx_runtime_1.jsx)("strong", { children: active?.label ?? 'No active match' })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: "ON DECK" }), (0, jsx_runtime_1.jsx)("strong", { children: onDeck?.label ?? 'None' })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: "IN THE HOLE" }), (0, jsx_runtime_1.jsx)("strong", { children: inHole?.label ?? 'None' })] })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "section-head", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Fight card" }), (0, jsx_runtime_1.jsx)("h2", { children: "Field One Order" })] }), (0, jsx_runtime_1.jsxs)("span", { children: [ordered.filter(m => m.status !== 'finalized').length, " remaining"] })] }), (0, jsx_runtime_1.jsx)("div", { className: "match-list", children: ordered.map(match => (0, jsx_runtime_1.jsx)(MatchCard_1.MatchCard, { match: match, roster: roster, onScore: canScore ? () => setScoring(match) : undefined, onMove: canReorder ? d => reorderMatch(match.id, d) : undefined, onStatus: canReorder ? status => setMatchStatus(match.id, status) : undefined }, match.id)) }), scoring && (0, jsx_runtime_1.jsx)(ScoreDialog_1.ScoreDialog, { match: scoring, roster: roster, onClose: () => setScoring(null), onSubmit: (rounds, forfeit) => finalizeResult(scoring.id, rounds, forfeit) })] });
}

},
"pages/PublicPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicPage = PublicPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const MatchCard_1 = require("../components/MatchCard");
const AppState_1 = require("../features/AppState");
const stream_1 = require("../lib/stream");
function PublicPage() {
    const { event, matches, roster, announcements } = (0, AppState_1.useAppState)();
    if (!event)
        return null;
    const embed = (0, stream_1.resolveStreamEmbed)(event.livestreamUrl);
    const visible = [...matches].sort((a, b) => a.scheduledOrder - b.scheduledOrder).filter(m => ['active', 'on_deck', 'in_the_hole', 'finalized'].includes(m.status)).slice(0, 5);
    return (0, jsx_runtime_1.jsxs)("div", { className: "public-page", children: [(0, jsx_runtime_1.jsxs)("section", { className: "public-hero", children: [(0, jsx_runtime_1.jsx)("span", { className: "live-dot", children: "LIVE" }), (0, jsx_runtime_1.jsx)("h1", { children: event.name }), (0, jsx_runtime_1.jsx)("p", { children: event.venue }), event.livestreamUrl && (0, jsx_runtime_1.jsx)("a", { className: "stream-btn", href: event.livestreamUrl, target: "_blank", rel: "noreferrer", children: "Open Livestream" })] }), embed && (0, jsx_runtime_1.jsx)("div", { className: "stream-frame", children: (0, jsx_runtime_1.jsx)("iframe", { src: embed.embedUrl, title: `${embed.provider} livestream`, allow: "autoplay; encrypted-media; picture-in-picture", allowFullScreen: true }) }), (0, jsx_runtime_1.jsx)("section", { className: "section-head", children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Spectator view" }), (0, jsx_runtime_1.jsx)("h2", { children: "Current Fight Order" })] }) }), (0, jsx_runtime_1.jsx)("div", { className: "match-list public", children: visible.map(match => (0, jsx_runtime_1.jsx)(MatchCard_1.MatchCard, { match: match, roster: roster }, match.id)) }), (0, jsx_runtime_1.jsx)("section", { className: "section-head", children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Updates" }), (0, jsx_runtime_1.jsx)("h2", { children: "Announcements" })] }) }), (0, jsx_runtime_1.jsx)("div", { className: "announcement-list", children: announcements.filter(a => a.isPublic).map(a => (0, jsx_runtime_1.jsxs)("article", { children: [(0, jsx_runtime_1.jsx)("b", { children: a.title }), (0, jsx_runtime_1.jsx)("p", { children: a.body })] }, a.id)) })] });
}

},
"pages/RegistrationPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistrationPage = RegistrationPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const AppState_1 = require("../features/AppState");
const registration_1 = require("../lib/registration");
function RegistrationPage() {
    const { event } = (0, AppState_1.useAppState)();
    const [form, setForm] = (0, react_1.useState)({ email: '', displayName: '', teamName: '', category: 'Duel', phone: '', emergencyContact: '', waiverAcknowledged: false });
    const [file, setFile] = (0, react_1.useState)(null);
    const [result, setResult] = (0, react_1.useState)(null);
    const [message, setMessage] = (0, react_1.useState)('');
    const [busy, setBusy] = (0, react_1.useState)(false);
    if (!event)
        return (0, jsx_runtime_1.jsx)("main", { className: "public-form-shell", children: (0, jsx_runtime_1.jsx)("div", { className: "state-card", children: "Loading event…" }) });
    const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
    const submit = async () => {
        setBusy(true);
        setMessage('');
        try {
            const created = await (0, registration_1.submitRegistration)({ eventId: event.id, ...form });
            if (file)
                await (0, registration_1.uploadWaiver)(created, file);
            setResult(created);
            setMessage('Registration saved.');
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : 'Registration failed.');
        }
        finally {
            setBusy(false);
        }
    };
    const pay = async () => {
        if (!result)
            return;
        setBusy(true);
        setMessage('');
        try {
            const url = await (0, registration_1.createRegistrationCheckout)(result);
            if (url === 'demo://checkout')
                setMessage('Demo mode: payment checkout is configured but no real charge is made.');
            else if (url)
                window.location.assign(url);
            else
                setMessage('No payment is required for this registration.');
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : 'Unable to start payment.');
        }
        finally {
            setBusy(false);
        }
    };
    return (0, jsx_runtime_1.jsx)("main", { className: "public-form-shell", children: (0, jsx_runtime_1.jsxs)("section", { className: "registration-card", children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Event registration" }), (0, jsx_runtime_1.jsx)("h1", { children: event.name }), (0, jsx_runtime_1.jsx)("p", { children: event.venue }), !event.registrationOpen && (0, jsx_runtime_1.jsx)("div", { className: "validation-errors", children: "Registration is currently closed." }), !result ? (0, jsx_runtime_1.jsxs)("div", { className: "form-grid", children: [(0, jsx_runtime_1.jsxs)("label", { children: ["Full name", (0, jsx_runtime_1.jsx)("input", { value: form.displayName, onChange: e => set('displayName', e.target.value) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Email", (0, jsx_runtime_1.jsx)("input", { type: "email", value: form.email, onChange: e => set('email', e.target.value) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Team", (0, jsx_runtime_1.jsx)("input", { value: form.teamName, onChange: e => set('teamName', e.target.value) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Category", (0, jsx_runtime_1.jsxs)("select", { value: form.category, onChange: e => set('category', e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { children: "Duel" }), (0, jsx_runtime_1.jsx)("option", { children: "Sword & Buckler" }), (0, jsx_runtime_1.jsx)("option", { children: "5v5" }), (0, jsx_runtime_1.jsx)("option", { children: "12v12" })] })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Phone", (0, jsx_runtime_1.jsx)("input", { type: "tel", value: form.phone, onChange: e => set('phone', e.target.value) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Emergency contact", (0, jsx_runtime_1.jsx)("input", { value: form.emergencyContact, onChange: e => set('emergencyContact', e.target.value) })] }), (0, jsx_runtime_1.jsxs)("label", { className: "full", children: ["Waiver file ", (0, jsx_runtime_1.jsx)("span", { className: "hint", children: "PDF, JPG, or PNG up to 10 MB" }), (0, jsx_runtime_1.jsx)("input", { type: "file", accept: "application/pdf,image/jpeg,image/png", onChange: e => setFile(e.target.files?.[0] ?? null) })] }), (0, jsx_runtime_1.jsxs)("label", { className: "checkbox-line full", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: form.waiverAcknowledged, onChange: e => set('waiverAcknowledged', e.target.checked) }), (0, jsx_runtime_1.jsx)("span", { children: "I confirm I have read and accept the event waiver." })] }), (0, jsx_runtime_1.jsx)("button", { className: "primary big full", disabled: busy || !event.registrationOpen || !form.displayName || !form.email || !form.waiverAcknowledged, onClick: submit, children: busy ? 'Saving…' : 'Submit Registration' })] }) : (0, jsx_runtime_1.jsxs)("div", { className: "success-box", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Registration received" }), (0, jsx_runtime_1.jsxs)("p", { children: ["Your registration ID is ", (0, jsx_runtime_1.jsx)("code", { children: result.registrationId }), "."] }), result.paymentRequired ? (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("p", { children: ["Registration fee: ", (result.amountCents / 100).toLocaleString(undefined, { style: 'currency', currency: result.currency })] }), (0, jsx_runtime_1.jsx)("button", { className: "primary big", onClick: pay, disabled: busy, children: "Continue to Payment" })] }) : (0, jsx_runtime_1.jsx)("p", { children: "No payment is required." })] }), message && (0, jsx_runtime_1.jsx)("div", { className: "auth-message", children: message })] }) });
}

},
"pages/RosterPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RosterPage = RosterPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const AppState_1 = require("../features/AppState");
const compliance_1 = require("../lib/compliance");
const permissions_1 = require("../lib/permissions");
const fields = [
    ['checkedIn', 'Check in'], ['armorCleared', 'Armor'], ['medicalCleared', 'Medical'], ['waiverConfirmed', 'Waiver'], ['weighInCleared', 'Weigh in']
];
function RosterPage() {
    const { roster, updateCompliance, user, event } = (0, AppState_1.useAppState)();
    const canManage = Boolean(event && (0, permissions_1.hasPermission)(user, 'roster.manage', event.id, event.organizationId));
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("section", { className: "section-head", children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Event roster" }), (0, jsx_runtime_1.jsx)("h1", { children: "Compliance Gate" }), (0, jsx_runtime_1.jsx)("p", { children: "Competitors cannot be placed into live competition until required clearances are complete." })] }) }), (0, jsx_runtime_1.jsx)("div", { className: "roster-list", children: roster.map(entry => {
                    const compliance = (0, compliance_1.checkCompliance)(entry);
                    return (0, jsx_runtime_1.jsxs)("article", { className: "roster-card", children: [(0, jsx_runtime_1.jsxs)("div", { className: "roster-main", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: entry.displayName }), (0, jsx_runtime_1.jsxs)("small", { children: [entry.entryType.replaceAll('_', ' '), entry.teamId ? ` • ${entry.teamId}` : ''] })] }), (0, jsx_runtime_1.jsx)("span", { className: `eligibility ${compliance.eligible ? 'ok' : 'blocked'}`, children: compliance.eligible ? 'CLEARED' : 'BLOCKED' })] }), (0, jsx_runtime_1.jsx)("div", { className: "check-grid", children: fields.map(([field, label]) => (0, jsx_runtime_1.jsxs)("label", { className: entry[field] ? 'checked' : '', children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: entry[field], disabled: !canManage, onChange: e => updateCompliance(entry.id, field, e.target.checked) }), (0, jsx_runtime_1.jsx)("span", { children: label })] }, field)) }), !compliance.eligible && (0, jsx_runtime_1.jsxs)("div", { className: "missing-line", children: ["Missing: ", compliance.missing.join(', ')] })] }, entry.id);
                }) })] });
}

}
};
