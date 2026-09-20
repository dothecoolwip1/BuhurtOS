export const modules2={
"components/ScoreDialog": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoreDialog = ScoreDialog;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const scoring_1 = require("../lib/scoring");
function ScoreDialog({ match, roster, onClose, onSubmit }) {
    const [rounds, setRounds] = (0, react_1.useState)(Array.from({ length: match.scoringConfig.roundsRequired }, (_, i) => ({ roundNumber: i + 1, side1Score: 0, side2Score: 0 })));
    const [forfeitSide, setForfeitSide] = (0, react_1.useState)('');
    const [forfeitReason, setForfeitReason] = (0, react_1.useState)('');
    const [submitting, setSubmitting] = (0, react_1.useState)(false);
    const [serverError, setServerError] = (0, react_1.useState)('');
    const validation = (0, react_1.useMemo)(() => (0, scoring_1.validateScore)(match.scoringConfig, rounds, forfeitSide ? { side: Number(forfeitSide), reason: forfeitReason } : undefined), [match.scoringConfig, rounds, forfeitSide, forfeitReason]);
    const name = (side) => {
        const p = match.participants.find(x => x.sideIndex === side);
        return roster.find(r => r.id === p?.rosterEntryId)?.displayName ?? p?.placeholderLabel ?? `Side ${side}`;
    };
    const change = (index, side, value) => setRounds(current => current.map((r, i) => i === index ? { ...r, [side === 1 ? 'side1Score' : 'side2Score']: value } : r));
    const submit = async () => {
        if (!validation.valid)
            return;
        setSubmitting(true);
        setServerError('');
        try {
            await onSubmit(rounds, forfeitSide ? { side: Number(forfeitSide), reason: forfeitReason } : undefined);
            onClose();
        }
        catch (e) {
            setServerError(e instanceof Error ? e.message : 'Unable to submit result.');
        }
        finally {
            setSubmitting(false);
        }
    };
    return (0, jsx_runtime_1.jsx)("div", { className: "dialog-backdrop", role: "presentation", onMouseDown: e => e.currentTarget === e.target && onClose(), children: (0, jsx_runtime_1.jsxs)("section", { className: "dialog", role: "dialog", "aria-modal": "true", "aria-label": `Score ${match.label}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "dialog-head", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow", children: "Guided scoring" }), (0, jsx_runtime_1.jsx)("h2", { children: match.label })] }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn", onClick: onClose, children: "×" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "score-names", children: [(0, jsx_runtime_1.jsx)("strong", { children: name(1) }), (0, jsx_runtime_1.jsx)("span", { children: "vs" }), (0, jsx_runtime_1.jsx)("strong", { children: name(2) })] }), !forfeitSide && (0, jsx_runtime_1.jsx)("div", { className: "round-list", children: rounds.map((round, index) => (0, jsx_runtime_1.jsxs)("div", { className: "round-row", children: [(0, jsx_runtime_1.jsxs)("b", { children: ["Round ", round.roundNumber] }), (0, jsx_runtime_1.jsx)("input", { type: "number", min: "0", inputMode: "numeric", value: round.side1Score, onChange: e => change(index, 1, Number(e.target.value)) }), (0, jsx_runtime_1.jsx)("span", { children: ":" }), (0, jsx_runtime_1.jsx)("input", { type: "number", min: "0", inputMode: "numeric", value: round.side2Score, onChange: e => change(index, 2, Number(e.target.value)) })] }, round.roundNumber)) }), (0, jsx_runtime_1.jsxs)("div", { className: "forfeit-box", children: [(0, jsx_runtime_1.jsxs)("label", { children: ["Forfeit side", (0, jsx_runtime_1.jsxs)("select", { value: forfeitSide, onChange: e => setForfeitSide(e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "No forfeit" }), (0, jsx_runtime_1.jsx)("option", { value: "1", children: name(1) }), (0, jsx_runtime_1.jsx)("option", { value: "2", children: name(2) })] })] }), forfeitSide && (0, jsx_runtime_1.jsxs)("label", { children: ["Reason", (0, jsx_runtime_1.jsx)("input", { value: forfeitReason, onChange: e => setForfeitReason(e.target.value), placeholder: "Required reason" })] })] }), !validation.valid && (0, jsx_runtime_1.jsx)("div", { className: "validation-errors", children: validation.errors.map(error => (0, jsx_runtime_1.jsx)("div", { children: error }, error)) }), validation.valid && validation.result && (0, jsx_runtime_1.jsxs)("div", { className: "result-preview", children: [(0, jsx_runtime_1.jsx)("b", { children: "Auto result:" }), " ", validation.result.winnerSide ? `${name(validation.result.winnerSide)} wins` : 'Draw', " • ", validation.result.side1Total, " : ", validation.result.side2Total] }), serverError && (0, jsx_runtime_1.jsx)("div", { className: "validation-errors", children: serverError }), (0, jsx_runtime_1.jsxs)("div", { className: "dialog-actions", children: [(0, jsx_runtime_1.jsx)("button", { onClick: onClose, children: "Cancel" }), (0, jsx_runtime_1.jsx)("button", { className: "primary", disabled: !validation.valid || submitting, onClick: submit, children: submitting ? 'Saving…' : 'Finalize Result' })] })] }) });
}

},
"data/demo": function(module, exports, require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.demoUser = exports.demoAnnouncements = exports.demoMatches = exports.demoRoster = exports.demoEvent = void 0;
exports.demoEvent = {
    id: 'event-hacsa-demo',
    organizationId: 'org-hacsa',
    seasonId: 'season-2026',
    name: 'HACSA Field Test Tournament',
    venue: 'Springbrook, Alberta',
    startsAt: '2026-09-20T16:00:00.000Z',
    endsAt: '2026-09-21T01:00:00.000Z',
    organizerName: 'HACSA',
    eventType: 'ranked_competitive',
    standingsMode: 'season_and_event',
    status: 'live',
    timezone: 'America/Edmonton',
    livestreamUrl: 'https://www.youtube.com/',
    registrationOpen: true,
    registrationFeeCents: 2500,
    currency: 'CAD'
};
exports.demoRoster = [
    { id: 'r1', organizationId: 'org-hacsa', eventId: exports.demoEvent.id, teamId: 'team-reavers', fighterId: 'f1', entryType: 'fighter', displayName: 'Garrett R.', checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'approved' },
    { id: 'r2', organizationId: 'org-hacsa', eventId: exports.demoEvent.id, teamId: 'team-reavers', fighterId: 'f2', entryType: 'fighter', displayName: 'Kolby H.', checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'approved' },
    { id: 'r3', organizationId: 'org-hacsa', eventId: exports.demoEvent.id, teamId: 'team-north', fighterId: 'f3', entryType: 'fighter', displayName: 'Alex M.', checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'approved' },
    { id: 'r4', organizationId: 'org-hacsa', eventId: exports.demoEvent.id, teamId: 'team-north', fighterId: 'f4', entryType: 'fighter', displayName: 'Morgan T.', checkedIn: true, armorCleared: false, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'registered' },
    { id: 'r5', organizationId: 'org-hacsa', eventId: exports.demoEvent.id, teamId: 'team-west', entryType: 'ghost_fighter', displayName: 'Guest Fighter 12', checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: false, attendanceStatus: 'approved', metadata: { mergeCandidate: true } },
    { id: 'r6', organizationId: 'org-hacsa', eventId: exports.demoEvent.id, teamId: 'team-west', fighterId: 'f6', entryType: 'fighter', displayName: 'Casey B.', checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'approved' }
];
exports.demoMatches = [
    {
        id: 'm1', organizationId: 'org-hacsa', seasonId: 'season-2026', eventId: exports.demoEvent.id, fightCardId: 'card-a', bracketId: 'bracket-a',
        label: 'Quarterfinal 1', category: 'Duel', matchType: 'longsword', scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false, scoreCapPerRound: 10 },
        status: 'active', stage: 'bracket', scheduledOrder: 1, bracketRound: 1, bracketSlot: '1-1', winnerAdvancesToMatchId: 'm5', winnerAdvancesToSlot: 1,
        participants: [{ rosterEntryId: 'r1', sideIndex: 1, seed: 1 }, { rosterEntryId: 'r3', sideIndex: 2, seed: 4 }], rounds: []
    },
    {
        id: 'm2', organizationId: 'org-hacsa', seasonId: 'season-2026', eventId: exports.demoEvent.id, fightCardId: 'card-a', bracketId: 'bracket-a',
        label: 'Quarterfinal 2', category: 'Duel', matchType: 'longsword', scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false, scoreCapPerRound: 10 },
        status: 'on_deck', stage: 'bracket', scheduledOrder: 2, bracketRound: 1, bracketSlot: '1-2', winnerAdvancesToMatchId: 'm5', winnerAdvancesToSlot: 2,
        participants: [{ rosterEntryId: 'r2', sideIndex: 1, seed: 2 }, { rosterEntryId: 'r6', sideIndex: 2, seed: 3 }], rounds: []
    },
    {
        id: 'm3', organizationId: 'org-hacsa', seasonId: 'season-2026', eventId: exports.demoEvent.id, fightCardId: 'card-a',
        label: 'Sword & Buckler Pool A', category: 'Sword & Buckler', matchType: 'sword_buckler', scoringConfig: { kind: 'sword_buckler', roundsRequired: 2, allowDrawRound: false, scoreCapPerRound: 5 },
        status: 'in_the_hole', stage: 'pool', scheduledOrder: 3,
        participants: [{ rosterEntryId: 'r5', sideIndex: 1 }, { rosterEntryId: 'r3', sideIndex: 2 }], rounds: []
    },
    {
        id: 'm4', organizationId: 'org-hacsa', seasonId: 'season-2026', eventId: exports.demoEvent.id, fightCardId: 'card-a',
        label: 'Pool A Match 1', category: 'Duel', matchType: 'longsword', scoringConfig: { kind: 'duel', roundsRequired: 1, allowDrawRound: false, scoreCapPerRound: 10 },
        status: 'finalized', stage: 'pool', scheduledOrder: 0,
        participants: [{ rosterEntryId: 'r1', sideIndex: 1 }, { rosterEntryId: 'r2', sideIndex: 2 }],
        rounds: [{ roundNumber: 1, side1Score: 7, side2Score: 4 }],
        resultSummary: { winnerSide: 1, side1Total: 7, side2Total: 4, roundsWonSide1: 1, roundsWonSide2: 0, resultType: 'points' }
    },
    {
        id: 'm5', organizationId: 'org-hacsa', seasonId: 'season-2026', eventId: exports.demoEvent.id, fightCardId: 'card-a', bracketId: 'bracket-a',
        label: 'Semifinal 1', category: 'Duel', matchType: 'longsword', scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false, scoreCapPerRound: 10 },
        status: 'scheduled', stage: 'bracket', scheduledOrder: 10, bracketRound: 2, bracketSlot: '2-1',
        participants: [
            { sideIndex: 1, isPlaceholder: true, placeholderLabel: 'Winner Quarterfinal 1', sourceMatchId: 'm1', sourceSlot: 1, isWinnerSource: true },
            { sideIndex: 2, isPlaceholder: true, placeholderLabel: 'Winner Quarterfinal 2', sourceMatchId: 'm2', sourceSlot: 2, isWinnerSource: true }
        ], rounds: []
    }
];
exports.demoAnnouncements = [
    { id: 'a1', eventId: exports.demoEvent.id, title: 'Field One Live', body: 'Duel bracket is now running on Field One.', isPublic: true, createdAt: '2026-09-20T16:15:00.000Z' },
    { id: 'a2', eventId: exports.demoEvent.id, title: 'Armor Check', body: 'Competitors in the next block should report to armor check.', isPublic: true, createdAt: '2026-09-20T16:20:00.000Z' }
];
exports.demoUser = {
    userId: 'demo-admin', displayName: 'Demo Event Organizer', platformRoles: [], organizationRoles: [{ organizationId: 'org-hacsa', role: 'organization_admin' }], eventRoles: [{ eventId: exports.demoEvent.id, role: 'event_organizer' }]
};

}
};
