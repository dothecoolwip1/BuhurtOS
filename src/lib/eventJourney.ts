import type { RecordState } from './finalization';

/**
 * The organizer's journey through an event (Pack 09D), worked out from facts the database already has. Pure; tested in eventJourney.test.ts.
 *
 *   Set up → Registration → Build tournament → Run event → Results → Close → History
 *
 * Every state has exactly ONE recommended action; everything else on the screen is secondary.
 */
export type Stage = 'setup' | 'registration' | 'build' | 'run' | 'results' | 'close' | 'history';
export const STAGES: ReadonlyArray<readonly [Stage, string]> = [
  ['setup', 'Set up'], ['registration', 'Registration'], ['build', 'Build tournament'], ['run', 'Run event'], ['results', 'Results'], ['close', 'Close'], ['history', 'History']
];

export interface CompetitionFact {
  id: string; name: string;
  /** Entrants still in (not withdrawn or disqualified). */
  active: number;
  fights: number; fightsDone: number;
  record: RecordState;
}
export interface JourneyFacts {
  status: 'draft' | 'published' | 'cancelled';
  eventType: string;
  closed: boolean; archived: boolean;
  competitions: readonly CompetitionFact[];
  registrations: { pending: number; accepted: number; total: number };
  checkin: { ready: number; accepted: number };
  /** Publishing is blocked by these (from the existing publish checklist), in plain words with where to fix them. */
  publishBlockers: ReadonlyArray<{ key: string; label: string }>;
  /** Today is one of the event's days. */
  eventDay: boolean;
}

export type ActionTarget =
  | { to: 'tab'; tab: string; query?: string }
  | { to: 'publish' }
  | { to: 'review'; competitionId: string }
  | { to: 'public' };
export interface JourneyAction { label: string; detail: string; target: ActionTarget }
export interface Journey {
  stage: Stage;
  headline: string;
  primary: JourneyAction | null;
  secondary: JourneyAction[];
}

/** A competition worth building: at least two entrants and no draw yet. Fewer entrants = offered but not run (never built into clutter). */
export const buildable = (c: CompetitionFact): boolean => c.record === 'no_draw' && c.active >= 2;
export const offeredOnly = (c: CompetitionFact): boolean => c.record === 'no_draw' && c.active < 2;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function journey(f: JourneyFacts): Journey {
  const comps = f.competitions;
  const drawn = comps.filter(c => c.record !== 'no_draw');
  const toBuild = comps.filter(buildable);
  const ready = comps.filter(c => c.record === 'ready');
  const official = comps.filter(c => c.record === 'official');
  const running = comps.filter(c => c.record === 'running' || c.record === 'reopened');
  const notCheckedIn = Math.max(0, f.checkin.accepted - f.checkin.ready);

  if (f.archived || f.closed) {
    return {
      stage: 'history', headline: f.archived ? 'This event is archived. Its results stay official and keep counting.' : 'This event is complete. Its results are official history.',
      primary: { label: 'View results', detail: 'The public results page', target: { to: 'public' } },
      secondary: f.closed && !f.archived ? [{ label: 'Archive event', detail: 'Hide it from current events (results still count)', target: { to: 'tab', tab: 'setup', query: 'focus=lifecycle' } }] : []
    };
  }
  if (f.status !== 'published') {
    if (f.eventType === 'tournament' && comps.length === 0) {
      return { stage: 'setup', headline: 'Your event is created. Next: choose what you are fighting.', primary: { label: 'Choose competitions', detail: 'Longsword, 5v5, Polearm…', target: { to: 'tab', tab: 'competitions' } }, secondary: [] };
    }
    const block = f.publishBlockers[0];
    if (block) {
      return {
        stage: 'setup', headline: 'Almost ready to open registration.',
        primary: { label: block.key === 'waiver' ? 'Add the waiver' : block.key === 'link' ? 'Set the sign-up link' : 'Finish setup', detail: block.label, target: { to: 'tab', tab: 'setup', query: `focus=${block.key === 'waiver' ? 'waiver' : 'details'}` } },
        secondary: [{ label: 'Event settings', detail: 'Dates, venue, fees, registration', target: { to: 'tab', tab: 'setup' } }]
      };
    }
    return {
      stage: 'setup', headline: `Your event is set up with ${plural(comps.length, 'competition')}.`,
      primary: { label: 'Open registration', detail: 'Publish the event so people can see it and sign up', target: { to: 'publish' } },
      secondary: [{ label: 'Event settings', detail: 'Fees, registration dates, description', target: { to: 'tab', tab: 'setup' } }]
    };
  }

  // published
  if (drawn.length === 0) {
    if (f.registrations.pending > 0) {
      return {
        stage: 'registration', headline: `Registration is open. ${plural(f.registrations.total, 'person has', 'people have')} registered.`,
        primary: { label: `Review ${plural(f.registrations.pending, 'registration')}`, detail: 'Accept or decline who is waiting', target: { to: 'tab', tab: 'review' } },
        secondary: toBuild.length > 0 ? [{ label: 'Build tournament', detail: `${plural(toBuild.length, 'competition')} can be built now`, target: { to: 'tab', tab: 'build' } }] : []
      };
    }
    if (toBuild.length > 0) {
      return {
        stage: 'build', headline: `Registration is ready. ${plural(toBuild.length, 'competition')} ${toBuild.length === 1 ? 'has' : 'have'} enough fighters to run.`,
        primary: { label: 'Build tournament', detail: 'BuhurtOS proposes the format, fields and fight order; you check it first', target: { to: 'tab', tab: 'build' } },
        secondary: [{ label: 'Registrations', detail: `${plural(f.registrations.accepted, 'accepted')}`, target: { to: 'tab', tab: 'review' } }]
      };
    }
    return {
      stage: 'registration', headline: f.registrations.total === 0 ? 'Registration is open. Nobody has registered yet.' : `Registration is open. ${plural(f.registrations.total, 'person has', 'people have')} registered.`,
      primary: { label: 'View the public page', detail: 'Share it so people can register', target: { to: 'public' } },
      secondary: [{ label: 'Registrations', detail: 'Everyone who signed up', target: { to: 'tab', tab: 'review' } }]
    };
  }

  // the tournament exists
  if (ready.length > 0) {
    const c = ready[0];
    return {
      stage: 'results', headline: `${c.name}: every fight is done. Check who won before it becomes official.`,
      primary: { label: 'Review wins & losses', detail: c.name, target: { to: 'review', competitionId: c.id } },
      secondary: [
        ...(running.length > 0 ? [{ label: 'Event day', detail: `${plural(running.length, 'competition')} still fighting`, target: { to: 'tab', tab: 'eventday' } } as JourneyAction] : []),
        ...(toBuild.length > 0 ? [{ label: 'Build the rest', detail: `${plural(toBuild.length, 'competition')} not built yet`, target: { to: 'tab', tab: 'build' } } as JourneyAction] : [])
      ]
    };
  }
  if (running.length === 0 && toBuild.length === 0 && official.length > 0) {
    return {
      stage: 'close', headline: 'Every competition is official.',
      primary: { label: 'Close event', detail: 'Lock the results as the permanent record', target: { to: 'tab', tab: 'finalize', query: 'closeout=1' } },
      secondary: [{ label: 'View results', detail: 'The public results page', target: { to: 'public' } }]
    };
  }
  const left = running.reduce((s, c) => s + (c.fights - c.fightsDone), 0);
  return {
    stage: 'run', headline: f.eventDay ? `The event is running. ${plural(left, 'fight')} to go.` : `The tournament is built: ${plural(left, 'fight')} to fight.`,
    primary: { label: 'Open Event day', detail: 'Who fights next, on every field', target: { to: 'tab', tab: 'eventday' } },
    secondary: [
      ...(f.eventDay && notCheckedIn > 0 ? [{ label: `Check in ${plural(notCheckedIn, 'fighter')}`, detail: `${f.checkin.ready} / ${f.checkin.accepted} ready`, target: { to: 'tab', tab: 'checkin' } } as JourneyAction] : []),
      ...(toBuild.length > 0 ? [{ label: 'Build the rest', detail: `${plural(toBuild.length, 'competition')} not built yet`, target: { to: 'tab', tab: 'build' } } as JourneyAction] : [])
    ]
  };
}

/** Where the stepper shows each stage: done, current or to come. */
export function stageState(current: Stage, s: Stage): 'done' | 'current' | 'todo' {
  const order = STAGES.map(([k]) => k);
  const a = order.indexOf(current), b = order.indexOf(s);
  return b < a ? 'done' : b === a ? 'current' : 'todo';
}
