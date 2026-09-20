export const modules11={
"pages/SyncPage": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncPage = SyncPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const AppState_1 = require("../features/AppState");
const offlineQueue_1 = require("../lib/offlineQueue");
function SyncPage() {
    const { online, syncNow, refreshQueue } = (0, AppState_1.useAppState)();
    const [items, setItems] = (0, react_1.useState)([]);
    const [busy, setBusy] = (0, react_1.useState)(false);
    const load = async () => setItems(await (0, offlineQueue_1.listMutations)());
    (0, react_1.useEffect)(() => { load(); }, []);
    const retry = async (id) => { await (0, offlineQueue_1.retryMutation)(id); await refreshQueue(); await load(); };
    const discard = async (id) => { await (0, offlineQueue_1.discardMutation)(id); await refreshQueue(); await load(); };
    const sync = async () => { setBusy(true); try {
        await syncNow();
        await load();
    }
    finally {
        setBusy(false);
    } };
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("section", { className: "section-head", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Offline recovery" }), (0, jsx_runtime_1.jsx)("h1", { children: "Sync Queue" }), (0, jsx_runtime_1.jsx)("p", { children: "Queued field actions stay on this device until the server accepts them. Conflicts require an explicit decision instead of silently overwriting another marshal." })] }), (0, jsx_runtime_1.jsx)("div", { className: "header-actions", children: (0, jsx_runtime_1.jsx)("button", { disabled: !online || busy, onClick: sync, children: busy ? 'Syncing…' : 'Sync Now' }) })] }), !online && (0, jsx_runtime_1.jsx)("div", { className: "state-card", children: "This device is offline. You can inspect or discard queued work, and BuhurtOS will retry automatically when the connection returns." }), items.length === 0 ? (0, jsx_runtime_1.jsx)("div", { className: "state-card", children: "No queued, failed, or conflicted actions." }) : (0, jsx_runtime_1.jsx)("div", { className: "sync-list", children: items.map(item => (0, jsx_runtime_1.jsxs)("article", { className: "sync-item", children: [(0, jsx_runtime_1.jsxs)("div", { className: "sync-item-head", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: item.entity.replaceAll('_', ' ') }), (0, jsx_runtime_1.jsx)("div", { children: (0, jsx_runtime_1.jsx)("code", { children: item.entityId }) })] }), (0, jsx_runtime_1.jsx)("span", { className: `sync-state ${item.state}`, children: item.state })] }), (0, jsx_runtime_1.jsxs)("small", { children: [new Date(item.createdAt).toLocaleString(), " · ", item.attempts, " attempt", item.attempts === 1 ? '' : 's'] }), item.lastError && (0, jsx_runtime_1.jsx)("div", { className: "sync-error", children: item.lastError }), (0, jsx_runtime_1.jsxs)("div", { className: "sync-actions", children: [(item.state === 'conflict' || item.state === 'failed') && (0, jsx_runtime_1.jsx)("button", { onClick: () => retry(item.id), children: "Retry Local Action" }), (0, jsx_runtime_1.jsx)("button", { onClick: () => discard(item.id), children: "Discard Local Action" })] })] }, item.id)) })] });
}

},
"types": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

}
};
