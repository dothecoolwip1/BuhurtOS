import type { ControlMode } from './eventPhaseView';

/**
 * Pack 25: the tools behind Event Control. The three MODES (Set up, Live ops, Results) are the screens an organizer lives on; a TOOL is one focused
 * job that opens from a mode and comes back to it. Every old Manage tab is a tool here, under the mode it belongs to by default, and any tool opens
 * from any mode (an attention item in Live ops can open the Run tools and come back to Live ops).
 */
export type ToolKey = 'settings' | 'competitions' | 'registrations' | 'entrants' | 'staff' | 'teams' | 'broadcast' | 'build' | 'run' | 'devices' | 'checkin';
export interface Tool { key: ToolKey; label: string; help: string; home: ControlMode; /** The event's permanent organizer only. */ organizer: boolean }

export const TOOLS: readonly Tool[] = [
  { key: 'competitions', label: 'Competitions', help: 'What is fought: category, ruleset, rounds to win, structure', home: 'setup', organizer: true },
  { key: 'registrations', label: 'Registrations', help: 'Accept, decline, fees, insurance, withdrawals, export', home: 'setup', organizer: true },
  { key: 'entrants', label: 'Entrants', help: 'Add or remove entrants by hand; invitations', home: 'setup', organizer: true },
  { key: 'build', label: 'Build tournament', help: 'Formats, draws, fields and fight order from the registrations', home: 'setup', organizer: true },
  { key: 'run', label: 'Draws and schedule', help: 'Each draw by hand: times, fields, withdrawals, teams represented', home: 'setup', organizer: true },
  { key: 'settings', label: 'Event settings', help: 'Dates, venue, fees, waiver, registration, publish, archive', home: 'setup', organizer: true },
  { key: 'staff', label: 'Staff and roles', help: 'Organizers, marshals, scorekeepers, check-in, medic', home: 'setup', organizer: true },
  { key: 'teams', label: 'Teams', help: 'Team requests and rosters', home: 'setup', organizer: true },
  { key: 'broadcast', label: 'Broadcast', help: 'Livestream, OBS overlay and sponsors', home: 'setup', organizer: true },
  { key: 'devices', label: 'Counters and devices', help: 'The Counter QR, event phones and tablets, the stream laptop', home: 'live', organizer: true },
  { key: 'checkin', label: 'Check-in list', help: 'Who has arrived, kit and waivers, as a list', home: 'live', organizer: true }
];
export const toolFor = (key: string | null | undefined): Tool | undefined => TOOLS.find(t => t.key === key);
export const isToolKey = (v: unknown): v is ToolKey => TOOLS.some(t => t.key === v);
export const toolsOf = (mode: ControlMode): Tool[] => TOOLS.filter(t => t.home === mode);

/** Which modes a viewer may open: the organizer all three; other staff (head marshal, secretary, a Temporary Organizer device) Live ops only. */
export const modesFor = (organizer: boolean): ControlMode[] => (organizer ? ['setup', 'live', 'results'] : ['live']);

/** The search string that carries an old Manage link's extras (match, competition, focus, closeout, created, notes) into Event Control unchanged. */
export const LEGACY_EXTRAS = ['match', 'competition', 'focus', 'closeout', 'created', 'notes', 'open'] as const;
