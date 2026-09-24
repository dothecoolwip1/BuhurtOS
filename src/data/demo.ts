import type { Announcement, EventRecord, MatchRecord, RosterEntry, UserContext } from '../types';

export const demoEvent: EventRecord = {
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

export const demoRoster: RosterEntry[] = [
  { id: 'r1', organizationId: 'org-hacsa', eventId: demoEvent.id, teamId: 'team-reavers', fighterId: 'f1', entryType: 'fighter', displayName: 'Garrett R.', checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'approved' },
  { id: 'r2', organizationId: 'org-hacsa', eventId: demoEvent.id, teamId: 'team-reavers', fighterId: 'f2', entryType: 'fighter', displayName: 'Kolby H.', checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'approved' },
  { id: 'r3', organizationId: 'org-hacsa', eventId: demoEvent.id, teamId: 'team-north', fighterId: 'f3', entryType: 'fighter', displayName: 'Alex M.', checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'approved' },
  { id: 'r4', organizationId: 'org-hacsa', eventId: demoEvent.id, teamId: 'team-north', fighterId: 'f4', entryType: 'fighter', displayName: 'Morgan T.', checkedIn: true, armorCleared: false, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'registered' },
  { id: 'r5', organizationId: 'org-hacsa', eventId: demoEvent.id, teamId: 'team-west', entryType: 'ghost_fighter', displayName: 'Guest Fighter 12', checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: false, attendanceStatus: 'approved', metadata: { mergeCandidate: true } },
  { id: 'r6', organizationId: 'org-hacsa', eventId: demoEvent.id, teamId: 'team-west', fighterId: 'f6', entryType: 'fighter', displayName: 'Casey B.', checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'approved' }
];

export const demoMatches: MatchRecord[] = [
  {
    id: 'm1', organizationId: 'org-hacsa', seasonId: 'season-2026', eventId: demoEvent.id, fightCardId: 'card-a', bracketId: 'bracket-a',
    label: 'Quarterfinal 1', category: 'Duel', matchType: 'longsword', scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false, scoreCapPerRound: 10 },
    status: 'active', stage: 'bracket', scheduledOrder: 1, bracketRound: 1, bracketSlot: '1-1', winnerAdvancesToMatchId: 'm5', winnerAdvancesToSlot: 1,
    participants: [{ rosterEntryId: 'r1', sideIndex: 1, seed: 1 }, { rosterEntryId: 'r3', sideIndex: 2, seed: 4 }], rounds: []
  },
  {
    id: 'm2', organizationId: 'org-hacsa', seasonId: 'season-2026', eventId: demoEvent.id, fightCardId: 'card-a', bracketId: 'bracket-a',
    label: 'Quarterfinal 2', category: 'Duel', matchType: 'longsword', scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false, scoreCapPerRound: 10 },
    status: 'on_deck', stage: 'bracket', scheduledOrder: 2, bracketRound: 1, bracketSlot: '1-2', winnerAdvancesToMatchId: 'm5', winnerAdvancesToSlot: 2,
    participants: [{ rosterEntryId: 'r2', sideIndex: 1, seed: 2 }, { rosterEntryId: 'r6', sideIndex: 2, seed: 3 }], rounds: []
  },
  {
    id: 'm3', organizationId: 'org-hacsa', seasonId: 'season-2026', eventId: demoEvent.id, fightCardId: 'card-a',
    label: 'Sword & Buckler Pool A', category: 'Sword & Buckler', matchType: 'sword_buckler', scoringConfig: { kind: 'sword_buckler', roundsRequired: 2, allowDrawRound: false, scoreCapPerRound: 5 },
    status: 'in_the_hole', stage: 'pool', scheduledOrder: 3,
    participants: [{ rosterEntryId: 'r5', sideIndex: 1 }, { rosterEntryId: 'r3', sideIndex: 2 }], rounds: []
  },
  {
    id: 'm4', organizationId: 'org-hacsa', seasonId: 'season-2026', eventId: demoEvent.id, fightCardId: 'card-a',
    label: 'Pool A Match 1', category: 'Duel', matchType: 'longsword', scoringConfig: { kind: 'duel', roundsRequired: 1, allowDrawRound: false, scoreCapPerRound: 10 },
    status: 'finalized', stage: 'pool', scheduledOrder: 0,
    participants: [{ rosterEntryId: 'r1', sideIndex: 1 }, { rosterEntryId: 'r2', sideIndex: 2 }],
    rounds: [{ roundNumber: 1, side1Score: 7, side2Score: 4 }],
    resultSummary: { winnerSide: 1, side1Total: 7, side2Total: 4, roundsWonSide1: 1, roundsWonSide2: 0, resultType: 'points' }
  },
  {
    id: 'm5', organizationId: 'org-hacsa', seasonId: 'season-2026', eventId: demoEvent.id, fightCardId: 'card-a', bracketId: 'bracket-a',
    label: 'Semifinal 1', category: 'Duel', matchType: 'longsword', scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false, scoreCapPerRound: 10 },
    status: 'scheduled', stage: 'bracket', scheduledOrder: 10, bracketRound: 2, bracketSlot: '2-1',
    participants: [
      { sideIndex: 1, isPlaceholder: true, placeholderLabel: 'Winner Quarterfinal 1', sourceMatchId: 'm1', sourceSlot: 1, isWinnerSource: true },
      { sideIndex: 2, isPlaceholder: true, placeholderLabel: 'Winner Quarterfinal 2', sourceMatchId: 'm2', sourceSlot: 2, isWinnerSource: true }
    ], rounds: []
  }
];

export const demoAnnouncements: Announcement[] = [
  { id: 'a1', eventId: demoEvent.id, title: 'Field One Live', body: 'Duel bracket is now running on Field One.', isPublic: true, createdAt: '2026-09-20T16:15:00.000Z' },
  { id: 'a2', eventId: demoEvent.id, title: 'Armor Check', body: 'Competitors in the next block should report to armor check.', isPublic: true, createdAt: '2026-09-20T16:20:00.000Z' }
];

export const demoUser: UserContext = {
  userId: 'demo-admin', displayName: 'Demo Event Organizer', platformRoles: [], organizationRoles: [{ organizationId: 'org-hacsa', role: 'organization_admin' }], eventRoles: [{ eventId: demoEvent.id, role: 'event_organizer' }], clubRoles: [], teamRoles: []
};
