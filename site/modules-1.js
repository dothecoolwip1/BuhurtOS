export const modules1={
"App": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.App = App;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_router_dom_1 = require("react-router-dom");
const Layout_1 = require("./components/Layout");
const RequirePermission_1 = require("./components/RequirePermission");
const AppState_1 = require("./features/AppState");
const supabase_1 = require("./lib/supabase");
const AdminPage_1 = require("./pages/AdminPage");
const BracketPage_1 = require("./pages/BracketPage");
const DisciplinePage_1 = require("./pages/DisciplinePage");
const LoginPage_1 = require("./pages/LoginPage");
const NotesPage_1 = require("./pages/NotesPage");
const OpsPage_1 = require("./pages/OpsPage");
const PublicPage_1 = require("./pages/PublicPage");
const RegistrationPage_1 = require("./pages/RegistrationPage");
const RosterPage_1 = require("./pages/RosterPage");
const StandingsPage_1 = require("./pages/StandingsPage");
const SyncPage_1 = require("./pages/SyncPage");
const SetupPage_1 = require("./pages/SetupPage");
function ProtectedLayout() {
    const { user, loading } = (0, AppState_1.useAppState)();
    if (loading)
        return (0, jsx_runtime_1.jsx)("div", { className: "center-screen", children: "Loading BuhurtOS…" });
    if (supabase_1.isSupabaseConfigured && !user)
        return (0, jsx_runtime_1.jsx)(react_router_dom_1.Navigate, { to: "/login", replace: true });
    return (0, jsx_runtime_1.jsx)(Layout_1.Layout, {});
}
function App() {
    return (0, jsx_runtime_1.jsx)(react_router_dom_1.HashRouter, { children: (0, jsx_runtime_1.jsxs)(react_router_dom_1.Routes, { children: [(0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/login", element: (0, jsx_runtime_1.jsx)(LoginPage_1.LoginPage, {}) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/public", element: (0, jsx_runtime_1.jsx)(PublicPage_1.PublicPage, {}) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/register", element: (0, jsx_runtime_1.jsx)(RegistrationPage_1.RegistrationPage, {}) }), (0, jsx_runtime_1.jsxs)(react_router_dom_1.Route, { element: (0, jsx_runtime_1.jsx)(ProtectedLayout, {}), children: [(0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/", element: (0, jsx_runtime_1.jsx)(RequirePermission_1.RequirePermission, { permission: "event.view_private", children: (0, jsx_runtime_1.jsx)(OpsPage_1.OpsPage, {}) }) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/roster", element: (0, jsx_runtime_1.jsx)(RequirePermission_1.RequirePermission, { permission: "event.view_private", children: (0, jsx_runtime_1.jsx)(RosterPage_1.RosterPage, {}) }) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/bracket", element: (0, jsx_runtime_1.jsx)(RequirePermission_1.RequirePermission, { permission: "event.view_private", children: (0, jsx_runtime_1.jsx)(BracketPage_1.BracketPage, {}) }) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/standings", element: (0, jsx_runtime_1.jsx)(RequirePermission_1.RequirePermission, { permission: "event.view_private", children: (0, jsx_runtime_1.jsx)(StandingsPage_1.StandingsPage, {}) }) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/admin", element: (0, jsx_runtime_1.jsx)(RequirePermission_1.RequirePermission, { permission: "bracket.manage", children: (0, jsx_runtime_1.jsx)(AdminPage_1.AdminPage, {}) }) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/discipline", element: (0, jsx_runtime_1.jsx)(RequirePermission_1.RequirePermission, { permission: "discipline.manage", children: (0, jsx_runtime_1.jsx)(DisciplinePage_1.DisciplinePage, {}) }) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/notes", element: (0, jsx_runtime_1.jsx)(RequirePermission_1.RequirePermission, { permission: "notes.team", children: (0, jsx_runtime_1.jsx)(NotesPage_1.NotesPage, {}) }) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/sync", element: (0, jsx_runtime_1.jsx)(RequirePermission_1.RequirePermission, { permission: "event.view_private", children: (0, jsx_runtime_1.jsx)(SyncPage_1.SyncPage, {}) }) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/setup", element: (0, jsx_runtime_1.jsx)(SetupPage_1.SetupPage, {}) })] }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "*", element: (0, jsx_runtime_1.jsx)(react_router_dom_1.Navigate, { to: "/", replace: true }) })] }) });
}

},
"components/Layout": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Layout = Layout;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_router_dom_1 = require("react-router-dom");
const AppState_1 = require("../features/AppState");
const permissions_1 = require("../lib/permissions");
const auth_1 = require("../lib/auth");
const nav = [
    ['/', 'Ops', '⚔'],
    ['/roster', 'Roster', '✓'],
    ['/bracket', 'Bracket', '⌘'],
    ['/standings', 'Standings', '≡'],
    ['/public', 'Public', '◎']
];
function Layout() {
    const { event, online, pendingCount, dataMode, syncNow, user } = (0, AppState_1.useAppState)();
    const can = (permission) => Boolean(event && (0, permissions_1.hasPermission)(user, permission, event.id, event.organizationId));
    const canSetup = Boolean(user?.platformRoles.includes('platform_super_admin') || user?.organizationRoles.some(role => role.role === 'organization_admin'));
    return ((0, jsx_runtime_1.jsxs)("div", { className: "app-shell", children: [(0, jsx_runtime_1.jsxs)("aside", { className: "side-rail", children: [(0, jsx_runtime_1.jsxs)("div", { className: "brand-block", children: [(0, jsx_runtime_1.jsx)("span", { className: "brand-mark", children: "B" }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("b", { children: "BuhurtOS" }), (0, jsx_runtime_1.jsx)("small", { children: "Buhurt Tournament Operations" })] })] }), (0, jsx_runtime_1.jsx)("nav", { children: nav.map(([to, label, icon]) => (0, jsx_runtime_1.jsxs)(react_router_dom_1.NavLink, { to: to, end: to === '/', children: [(0, jsx_runtime_1.jsx)("span", { children: icon }), label] }, to)) }), (0, jsx_runtime_1.jsxs)("div", { className: "utility-nav", children: [can('bracket.manage') && (0, jsx_runtime_1.jsx)(react_router_dom_1.NavLink, { to: "/admin", children: "Organizer Tools" }), can('discipline.manage') && (0, jsx_runtime_1.jsx)(react_router_dom_1.NavLink, { to: "/discipline", children: "Discipline" }), can('notes.team') && (0, jsx_runtime_1.jsx)(react_router_dom_1.NavLink, { to: "/notes", children: "Fight Notes" }), (0, jsx_runtime_1.jsx)(react_router_dom_1.NavLink, { to: "/sync", children: "Sync Queue" }), canSetup && (0, jsx_runtime_1.jsx)(react_router_dom_1.NavLink, { to: "/setup", children: "Setup" }), (0, jsx_runtime_1.jsx)(react_router_dom_1.NavLink, { to: `/register${event ? `?event=${event.id}` : ''}`, children: "Registration" }), dataMode === 'supabase' && (0, jsx_runtime_1.jsx)("button", { className: "link-button", onClick: () => (0, auth_1.signOut)(), children: "Sign Out" })] })] }), (0, jsx_runtime_1.jsxs)("main", { className: "main-shell", children: [(0, jsx_runtime_1.jsxs)("header", { className: "topbar", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: event?.name ?? 'BuhurtOS' }), (0, jsx_runtime_1.jsx)("small", { children: event?.venue ?? 'Loading event' })] }), (0, jsx_runtime_1.jsxs)("div", { className: "status-row", children: [(0, jsx_runtime_1.jsx)("span", { className: `status-pill ${online ? 'ok' : 'warn'}`, children: online ? 'Online' : 'Offline' }), (0, jsx_runtime_1.jsx)("span", { className: "status-pill", children: dataMode === 'supabase' ? 'Live DB' : 'Demo' }), pendingCount > 0 && (0, jsx_runtime_1.jsxs)("button", { className: "status-pill action", onClick: syncNow, children: [pendingCount, " queued"] })] })] }), (0, jsx_runtime_1.jsx)("div", { className: "page-wrap", children: (0, jsx_runtime_1.jsx)(react_router_dom_1.Outlet, {}) })] }), (0, jsx_runtime_1.jsx)("nav", { className: "bottom-nav", children: nav.map(([to, label, icon]) => (0, jsx_runtime_1.jsxs)(react_router_dom_1.NavLink, { to: to, end: to === '/', children: [(0, jsx_runtime_1.jsx)("span", { children: icon }), (0, jsx_runtime_1.jsx)("small", { children: label })] }, to)) })] }));
}

},
"components/MatchCard": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchCard = MatchCard;
const jsx_runtime_1 = require("react/jsx-runtime");
function MatchCard({ match, roster, onScore, onMove, onStatus }) {
    const name = (side) => {
        const p = match.participants.find(x => x.sideIndex === side);
        if (!p)
            return 'TBD';
        if (p.isPlaceholder)
            return p.placeholderLabel ?? 'TBD';
        return roster.find(r => r.id === p.rosterEntryId)?.displayName ?? 'Unknown';
    };
    return ((0, jsx_runtime_1.jsxs)("article", { className: `match-card status-${match.status}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "match-top", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: match.category }), (0, jsx_runtime_1.jsx)("h3", { children: match.label })] }), (0, jsx_runtime_1.jsx)("span", { className: "match-status", children: match.status.replaceAll('_', ' ') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "versus", children: [(0, jsx_runtime_1.jsx)("strong", { children: name(1) }), (0, jsx_runtime_1.jsx)("span", { children: "VS" }), (0, jsx_runtime_1.jsx)("strong", { children: name(2) })] }), match.resultSummary && (0, jsx_runtime_1.jsxs)("div", { className: "result-line", children: ["Final ", match.resultSummary.side1Total, " : ", match.resultSummary.side2Total] }), (onScore || onMove || onStatus) && (0, jsx_runtime_1.jsxs)("div", { className: "match-actions", children: [onStatus && match.status !== 'finalized' && match.status !== 'cancelled' && (0, jsx_runtime_1.jsxs)("div", { className: "status-actions", children: [(0, jsx_runtime_1.jsx)("button", { className: match.status === 'in_the_hole' ? 'selected' : '', onClick: () => onStatus('in_the_hole'), children: "In Hole" }), (0, jsx_runtime_1.jsx)("button", { className: match.status === 'on_deck' ? 'selected' : '', onClick: () => onStatus('on_deck'), children: "On Deck" }), (0, jsx_runtime_1.jsx)("button", { className: match.status === 'active' ? 'selected' : '', onClick: () => onStatus('active'), children: "Active" })] }), onMove && (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("button", { "aria-label": "Move match earlier", onClick: () => onMove(-1), children: "↑ Earlier" }), (0, jsx_runtime_1.jsx)("button", { "aria-label": "Move match later", onClick: () => onMove(1), children: "↓ Later" })] }), onScore && match.status === 'active' && (0, jsx_runtime_1.jsx)("button", { className: "primary", onClick: onScore, children: "Score Match" })] })] }));
}

},
"components/RequirePermission": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequirePermission = RequirePermission;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_router_dom_1 = require("react-router-dom");
const permissions_1 = require("../lib/permissions");
const AppState_1 = require("../features/AppState");
function RequirePermission({ permission, children }) {
    const { user, event, error } = (0, AppState_1.useAppState)();
    if (!event && error)
        return (0, jsx_runtime_1.jsx)(react_router_dom_1.Navigate, { to: "/setup", replace: true });
    if (!event)
        return (0, jsx_runtime_1.jsx)("div", { className: "state-card", children: "Loading access…" });
    if (!(0, permissions_1.hasPermission)(user, permission, event.id, event.organizationId))
        return (0, jsx_runtime_1.jsx)(react_router_dom_1.Navigate, { to: "/public", replace: true });
    return (0, jsx_runtime_1.jsx)(jsx_runtime_1.Fragment, { children: children });
}

}
};
