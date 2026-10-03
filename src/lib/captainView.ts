import type { CaptainedTeam } from '../data/myTeams';
import type { InboxRequest } from '../data/teamManager';

export interface CaptainTeamRow {
  teamId: string; name: string; slug: string;
  /** A proposed team is private until an organizer approves it; nobody can ask to join it yet. */
  awaitingApproval: boolean;
  /** Join requests waiting for this captain's answer. Always 0 for a team that is not approved yet. */
  waiting: number;
}

/** What Team manager shows for each team the person captains. Authority comes from the database; this only arranges what it returned. */
export function captainRows(teams: CaptainedTeam[], inbox: InboxRequest[]): CaptainTeamRow[] {
  return teams.map(t => ({
    teamId: t.teamId, name: t.name, slug: t.slug,
    awaitingApproval: t.status === 'pending',
    waiting: t.status === 'pending' ? 0 : inbox.filter(r => r.teamId === t.teamId).length
  })).sort((a, b) => a.name.localeCompare(b.name));
}

