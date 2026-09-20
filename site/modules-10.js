export const modules10={
"pages/SetupPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SetupPage = SetupPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const AppState_1 = require("../features/AppState");
const setup_1 = require("../lib/setup");
const supabase_1 = require("../lib/supabase");
const toIso = (value) => new Date(value).toISOString();
const initialYear = new Date().getFullYear();
function SetupPage() {
    const { user } = (0, AppState_1.useAppState)();
    const [organizations, setOrganizations] = (0, react_1.useState)([]);
    const [seasons, setSeasons] = (0, react_1.useState)([]);
    const [events, setEvents] = (0, react_1.useState)([]);
    const [orgId, setOrgId] = (0, react_1.useState)('');
    const [seasonId, setSeasonId] = (0, react_1.useState)('');
    const [orgForm, setOrgForm] = (0, react_1.useState)({ name: '', shortName: '', region: '' });
    const [seasonForm, setSeasonForm] = (0, react_1.useState)({ name: `${initialYear} Season`, startsAt: `${initialYear}-01-01T09:00`, endsAt: `${initialYear}-12-31T18:00` });
    const [eventForm, setEventForm] = (0, react_1.useState)({ name: '', venue: '', startsAt: '', endsAt: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', eventType: 'ranked_competitive', standingsMode: 'season_and_event' });
    const [message, setMessage] = (0, react_1.useState)('');
    const [busy, setBusy] = (0, react_1.useState)(false);
    const platformAdmin = Boolean(user?.platformRoles.includes('platform_super_admin'));
    const canCreateOrg = platformAdmin;
    const refreshOrgs = async () => { const rows = await (0, setup_1.listOrganizations)(); setOrganizations(rows); if (!orgId && rows[0])
        setOrgId(rows[0].id); };
    (0, react_1.useEffect)(() => { if (user)
        refreshOrgs().catch(e => setMessage(e.message)); }, [user?.userId]);
    (0, react_1.useEffect)(() => { if (!orgId) {
        setSeasons([]);
        setEvents([]);
        return;
    } (0, setup_1.listSeasons)(orgId).then(rows => { setSeasons(rows); if (!seasonId && rows[0])
        setSeasonId(rows[0].id); }).catch(e => setMessage(e.message)); (0, setup_1.listEvents)(orgId).then(setEvents).catch(e => setMessage(e.message)); }, [orgId]);
    if (!user)
        return (0, jsx_runtime_1.jsx)("div", { className: "state-card", children: "Sign in before configuring BuhurtOS." });
    if (!supabase_1.isSupabaseConfigured)
        return (0, jsx_runtime_1.jsx)("div", { className: "state-card", children: "Demo mode already contains a seeded organization, season, and event. Connect a dedicated Supabase project to use first-run setup." });
    const claim = async () => { setBusy(true); setMessage(''); try {
        const claimed = await (0, setup_1.claimFirstSuperAdmin)();
        setMessage(claimed ? 'This account is now the initial platform super admin. Reloading access…' : 'A platform administrator already exists. Ask that administrator to add you.');
        if (claimed)
            window.setTimeout(() => window.location.reload(), 500);
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : 'Unable to claim bootstrap role.');
    }
    finally {
        setBusy(false);
    } };
    const addOrg = async () => { if (!orgForm.name || !orgForm.shortName || !orgForm.region)
        return; setBusy(true); try {
        const org = await (0, setup_1.createOrganization)({ ...orgForm, userId: user.userId });
        await refreshOrgs();
        setOrgId(org.id);
        setOrgForm({ name: '', shortName: '', region: '' });
        setMessage('Organization created and you were assigned organization admin.');
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : 'Unable to create organization.');
    }
    finally {
        setBusy(false);
    } };
    const addSeason = async () => { if (!orgId || !seasonForm.name)
        return; setBusy(true); try {
        const season = await (0, setup_1.createSeason)({ organizationId: orgId, name: seasonForm.name, startsAt: toIso(seasonForm.startsAt), endsAt: toIso(seasonForm.endsAt), userId: user.userId });
        const rows = await (0, setup_1.listSeasons)(orgId);
        setSeasons(rows);
        setSeasonId(season.id);
        setMessage('Season created.');
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : 'Unable to create season.');
    }
    finally {
        setBusy(false);
    } };
    const addEvent = async () => { if (!orgId || !seasonId || !eventForm.name || !eventForm.venue || !eventForm.startsAt || !eventForm.endsAt)
        return; setBusy(true); try {
        const eventId = await (0, setup_1.createEvent)({ organizationId: orgId, seasonId, name: eventForm.name, venue: eventForm.venue, startsAt: toIso(eventForm.startsAt), endsAt: toIso(eventForm.endsAt), timezone: eventForm.timezone, eventType: eventForm.eventType, standingsMode: eventForm.standingsMode, userId: user.userId });
        window.location.assign(`/?event=${eventId}`);
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : 'Unable to create event.');
    }
    finally {
        setBusy(false);
    } };
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("section", { className: "section-head", children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "First run & organization" }), (0, jsx_runtime_1.jsx)("h1", { children: "BuhurtOS Setup" }), (0, jsx_runtime_1.jsx)("p", { children: "Create the tenant hierarchy without manual SQL. The first platform administrator claim only succeeds on a database that has no platform memberships." })] }) }), !platformAdmin && user.organizationRoles.length === 0 && (0, jsx_runtime_1.jsxs)("section", { className: "panel-card setup-callout", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Bootstrap first administrator" }), (0, jsx_runtime_1.jsx)("p", { children: "If this is a brand new BuhurtOS database, claim the one-time platform administrator role. Once claimed, this path permanently closes." }), (0, jsx_runtime_1.jsx)("button", { className: "primary", disabled: busy, onClick: claim, children: "Claim First Platform Admin" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "admin-grid", children: [(0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Organization" }), (0, jsx_runtime_1.jsxs)("label", { className: "form-stack", children: ["Current organization", (0, jsx_runtime_1.jsxs)("select", { value: orgId, onChange: e => { setOrgId(e.target.value); setSeasonId(''); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "Choose organization" }), organizations.map(org => (0, jsx_runtime_1.jsx)("option", { value: org.id, children: org.name }, org.id))] })] }), canCreateOrg && (0, jsx_runtime_1.jsxs)("div", { className: "form-stack setup-subform", children: [(0, jsx_runtime_1.jsx)("input", { placeholder: "Organization name", value: orgForm.name, onChange: e => setOrgForm(f => ({ ...f, name: e.target.value })) }), (0, jsx_runtime_1.jsx)("input", { placeholder: "Short name", value: orgForm.shortName, onChange: e => setOrgForm(f => ({ ...f, shortName: e.target.value })) }), (0, jsx_runtime_1.jsx)("input", { placeholder: "Region", value: orgForm.region, onChange: e => setOrgForm(f => ({ ...f, region: e.target.value })) }), (0, jsx_runtime_1.jsx)("button", { onClick: addOrg, disabled: busy, children: "Create Organization" })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Season" }), (0, jsx_runtime_1.jsxs)("label", { className: "form-stack", children: ["Current season", (0, jsx_runtime_1.jsxs)("select", { value: seasonId, onChange: e => setSeasonId(e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "Choose season" }), seasons.map(season => (0, jsx_runtime_1.jsx)("option", { value: season.id, children: season.name }, season.id))] })] }), orgId && (0, jsx_runtime_1.jsxs)("div", { className: "form-stack setup-subform", children: [(0, jsx_runtime_1.jsx)("input", { value: seasonForm.name, onChange: e => setSeasonForm(f => ({ ...f, name: e.target.value })) }), (0, jsx_runtime_1.jsxs)("label", { children: ["Starts", (0, jsx_runtime_1.jsx)("input", { type: "datetime-local", value: seasonForm.startsAt, onChange: e => setSeasonForm(f => ({ ...f, startsAt: e.target.value })) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Ends", (0, jsx_runtime_1.jsx)("input", { type: "datetime-local", value: seasonForm.endsAt, onChange: e => setSeasonForm(f => ({ ...f, endsAt: e.target.value })) })] }), (0, jsx_runtime_1.jsx)("button", { onClick: addSeason, disabled: busy, children: "Create Season" })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "New event" }), (0, jsx_runtime_1.jsxs)("div", { className: "form-stack", children: [(0, jsx_runtime_1.jsx)("input", { placeholder: "Event name", value: eventForm.name, onChange: e => setEventForm(f => ({ ...f, name: e.target.value })) }), (0, jsx_runtime_1.jsx)("input", { placeholder: "Venue", value: eventForm.venue, onChange: e => setEventForm(f => ({ ...f, venue: e.target.value })) }), (0, jsx_runtime_1.jsxs)("label", { children: ["Starts", (0, jsx_runtime_1.jsx)("input", { type: "datetime-local", value: eventForm.startsAt, onChange: e => setEventForm(f => ({ ...f, startsAt: e.target.value })) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Ends", (0, jsx_runtime_1.jsx)("input", { type: "datetime-local", value: eventForm.endsAt, onChange: e => setEventForm(f => ({ ...f, endsAt: e.target.value })) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Timezone", (0, jsx_runtime_1.jsx)("input", { value: eventForm.timezone, onChange: e => setEventForm(f => ({ ...f, timezone: e.target.value })) })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Event type", (0, jsx_runtime_1.jsxs)("select", { value: eventForm.eventType, onChange: e => setEventForm(f => ({ ...f, eventType: e.target.value })), children: [(0, jsx_runtime_1.jsx)("option", { value: "ranked_competitive", children: "Ranked competitive" }), (0, jsx_runtime_1.jsx)("option", { value: "demo_fun", children: "Demo / fun" }), (0, jsx_runtime_1.jsx)("option", { value: "exhibition", children: "Exhibition" }), (0, jsx_runtime_1.jsx)("option", { value: "clinic_training", children: "Clinic / training" }), (0, jsx_runtime_1.jsx)("option", { value: "custom", children: "Custom" })] })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["Standings", (0, jsx_runtime_1.jsxs)("select", { value: eventForm.standingsMode, onChange: e => setEventForm(f => ({ ...f, standingsMode: e.target.value })), children: [(0, jsx_runtime_1.jsx)("option", { value: "season_and_event", children: "Season + event" }), (0, jsx_runtime_1.jsx)("option", { value: "event_only", children: "Event only" }), (0, jsx_runtime_1.jsx)("option", { value: "no_standings", children: "No standings" })] })] }), (0, jsx_runtime_1.jsx)("button", { className: "primary", onClick: addEvent, disabled: busy || !seasonId, children: "Create Event" })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "panel-card", children: [(0, jsx_runtime_1.jsx)("h2", { children: "Existing events" }), (0, jsx_runtime_1.jsx)("div", { className: "membership-list", children: events.length === 0 ? (0, jsx_runtime_1.jsx)("div", { className: "state-card", children: "No events in this organization yet." }) : events.map(item => (0, jsx_runtime_1.jsxs)("article", { children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: item.name }), (0, jsx_runtime_1.jsxs)("small", { children: [item.venue, " · ", item.status] })] }), (0, jsx_runtime_1.jsx)("button", { onClick: () => window.location.assign(`/?event=${item.id}`), children: "Open" })] }, item.id)) })] })] }), message && (0, jsx_runtime_1.jsx)("div", { className: "auth-message", children: message })] });
}

},
"pages/StandingsPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StandingsPage = StandingsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const AppState_1 = require("../features/AppState");
const standings_1 = require("../lib/standings");
const export_1 = require("../lib/export");
function StandingsPage() {
    const { event, matches, roster } = (0, AppState_1.useAppState)();
    if (!event)
        return null;
    const rows = (0, standings_1.computeEventStandings)(event, matches, roster);
    const print = () => (0, export_1.openPrintableReport)(`${event.name} Standings`, `<table><thead><tr><th>Rank</th><th>Competitor</th><th>W</th><th>L</th><th>D</th><th>Pts</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td><td>${r.standingPoints}</td></tr>`).join('')}</tbody></table>`);
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("section", { className: "section-head", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: event.standingsMode.replaceAll('_', ' ') }), (0, jsx_runtime_1.jsx)("h1", { children: "Standings" }), (0, jsx_runtime_1.jsx)("p", { children: "Only finalized matches from standings-enabled events are counted." })] }), (0, jsx_runtime_1.jsxs)("div", { className: "header-actions", children: [(0, jsx_runtime_1.jsx)("button", { onClick: () => (0, export_1.downloadText)('buhurtos-standings.csv', (0, export_1.standingsCsv)(rows)), children: "Export CSV" }), (0, jsx_runtime_1.jsx)("button", { onClick: print, children: "Print / PDF" })] })] }), rows.length === 0 ? (0, jsx_runtime_1.jsx)("div", { className: "state-card", children: "This event is configured with no standings, or no finalized matches exist yet." }) : (0, jsx_runtime_1.jsx)("div", { className: "table-wrap", children: (0, jsx_runtime_1.jsxs)("table", { children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("th", { children: "#" }), (0, jsx_runtime_1.jsx)("th", { children: "Competitor" }), (0, jsx_runtime_1.jsx)("th", { children: "W" }), (0, jsx_runtime_1.jsx)("th", { children: "L" }), (0, jsx_runtime_1.jsx)("th", { children: "D" }), (0, jsx_runtime_1.jsx)("th", { children: "PF" }), (0, jsx_runtime_1.jsx)("th", { children: "PA" }), (0, jsx_runtime_1.jsx)("th", { children: "Diff" }), (0, jsx_runtime_1.jsx)("th", { children: "Pts" })] }) }), (0, jsx_runtime_1.jsx)("tbody", { children: rows.map((r, i) => (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { children: i + 1 }), (0, jsx_runtime_1.jsx)("td", { children: (0, jsx_runtime_1.jsx)("strong", { children: r.name }) }), (0, jsx_runtime_1.jsx)("td", { children: r.wins }), (0, jsx_runtime_1.jsx)("td", { children: r.losses }), (0, jsx_runtime_1.jsx)("td", { children: r.draws }), (0, jsx_runtime_1.jsx)("td", { children: r.pointsFor }), (0, jsx_runtime_1.jsx)("td", { children: r.pointsAgainst }), (0, jsx_runtime_1.jsx)("td", { children: r.differential }), (0, jsx_runtime_1.jsx)("td", { children: (0, jsx_runtime_1.jsx)("b", { children: r.standingPoints }) })] }, r.rosterEntryId)) })] }) })] });
}

}
};
