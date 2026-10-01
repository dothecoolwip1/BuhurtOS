export type EventType = 'tournament' | 'practice' | 'clinic' | 'demonstration' | 'gathering';
export type RegistrationMode = 'buhuros' | 'external' | 'none';

export const EVENT_TYPES: [EventType, string, string][] = [
  ['tournament', 'Tournament', 'Competitions with brackets, fighters and scoring.'],
  ['practice', 'Practice or training day', 'Open or club practice.'],
  ['clinic', 'Clinic or workshop', 'Teaching day.'],
  ['demonstration', 'Demonstration', 'Fighters showing the sport to an audience.'],
  ['gathering', 'Social gathering', 'A feast, dance, meet-up or fundraiser.']
];
export const eventTypeLabel = (t: string) => EVENT_TYPES.find(([k]) => k === t)?.[1] ?? t;

export const REGISTRATION_MODES: [RegistrationMode, string][] = [
  ['buhuros', 'People register on BuhurtOS (fighters, waiver, check-in)'],
  ['external', 'People sign up or buy tickets on another website (a link)'],
  ['none', 'No sign-up needed']
];
